<script lang="ts">
  /// import
  import { BaseDirectory, createDir, exists, readDir, readTextFile, writeTextFile } from "@tauri-apps/api/fs";
  import { metadata } from "tauri-plugin-fs-extra-api";
  import { parseZone } from "dnsz";
  import { sep as separator } from "@tauri-apps/api/path";
  import { parse as toml } from "smol-toml";
  import * as x509 from "@peculiar/x509";

  /// component
  import CopyButton from "./CopyButton.svelte";

  /// util
  import { AuthNS } from "../utility/authns";
  import { formatTextToWidth } from "../utility/format-text-width";
  import { generateSerial } from "../utility/generate-serial";
  import { getNextYearDate } from "../utility/date-next-year";
  import { getYesterdayDate } from "../utility/date-yesterday";
  import { readyForStep1 } from "../utility/store";
  import { toZone } from "../utility/to-zone";
  import type { ConfigFile, LooseObject } from "../utility/interface";

  /// function
  async function collectFiles(directory: string) {
    const domain = directory.split(separator).pop();

    const outputFile = [directory, "output.toml"].join(separator);
    const recordsFile = [directory, "records.toml"].join(separator);
    const zoneFile = [directory, `${domain}.zone`].join(separator);

    const outputFileContent = await readTextFile(outputFile, { dir: BaseDirectory.Document });
    const recordsFileContent = await readTextFile(recordsFile, { dir: BaseDirectory.Document });
    const { records: zone } = parseZone(await readTextFile(zoneFile, { dir: BaseDirectory.Document }));

    return {
      output: toml(outputFileContent),
      records: toml(recordsFileContent),
      zone
    };
  }

  async function regenerateCerts({ domain, nameserver }) {
    console.group("regenerateCerts()");

    const alg = {
      hash: "SHA-256",
      modulusLength: 2048,
      name: "RSASSA-PKCS1-v1_5",
      publicExponent: new Uint8Array([1, 0, 1])
    };

    const certFile = ["Dolo", domain, "tls", `${domain}.crt`].join(separator);
    const certFolder = ["Dolo", domain, "tls"].join(separator);
    const keyFile = ["Dolo", domain, "tls", `${domain}.key`].join(separator);
    const keys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);

    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      extensions: [
        new x509.BasicConstraintsExtension(false, 0, false),
        new x509.KeyUsagesExtension(
          x509.KeyUsageFlags.digitalSignature |
          x509.KeyUsageFlags.nonRepudiation |
          x509.KeyUsageFlags.keyEncipherment |
          x509.KeyUsageFlags.dataEncipherment,
          false
        ),
        new x509.SubjectAlternativeNameExtension([
          { type: "dns", value: domain },
          { type: "dns", value: `*.${domain}` },
          { type: "ip", value: nameserver }
        ], false)
      ],
      keys,
      name: `CN=${domain}`,
      notBefore: new Date(getYesterdayDate()),
      notAfter: new Date(getNextYearDate()),
      serialNumber: generateSerial(18),
      signingAlgorithm: alg
    });

    const doesDomainCertDirectoryExist = await exists(certFolder, { dir: BaseDirectory.Document });

    if (!doesDomainCertDirectoryExist) {
      await createDir(certFolder, { dir: BaseDirectory.Document, recursive: true });
      console.info(`WRITE | ${certFolder}.crt`);
    }

    await writeTextFile(certFile, cert.toString("pem"), { dir: BaseDirectory.Document });
    console.info(`WRITE | ${domain}.crt`);

    /// export private key to PKCS #8 format
    const exportKey = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
    /// convert ArrayBuffer to Uint8Array
    const exportKeyAsString = new Uint8Array(exportKey);
    /// convert Uint8Array to base64-encoded string
    const exportKeyAsBase64 = btoa(String.fromCharCode(...exportKeyAsString));
    /// add headers for PEM format
    const privateKeyPEM = `-----BEGIN PRIVATE KEY-----\n${formatTextToWidth(exportKeyAsBase64, 64)}\n-----END PRIVATE KEY-----`;

    await writeTextFile(keyFile, privateKeyPEM, { dir: BaseDirectory.Document });
    console.info(`WRITE | ${domain}.key`);

    const outputFileContent = await readTextFile(["Dolo", domain, "output.toml"].join(separator), { dir: BaseDirectory.Document });
    const { ksk, main, zsk } = toml(outputFileContent) as unknown as ConfigFile;
    const { host } = main;
    const { private: privateKSK, public: publicKSK } = ksk;
    const { private: privateZSK, public: publicZSK } = zsk;
    let records = [];

    const authns = new AuthNS({
      domain,
      host,
      kskkey: publicKSK,
      kskpriv: privateKSK,
      test: false,
      zskkey: publicZSK,
      zskpriv: privateZSK
    });

    await authns.regenerateTLSA();

    authns.server.zone.names.forEach(recordMap => {
      recordMap.rrs.forEach(rr => records = records.concat(rr));
      recordMap.sigs.forEach(rr => records = records.concat(rr));
    });

    const zone = toZone(records);
    const zoneFileContent = await readTextFile(["Dolo", domain, `${domain}.zone`].join(separator), { dir: BaseDirectory.Document });
    const zoneFileLines = zoneFileContent.split("\n");
    const zoneFileFiltered = zoneFileLines.filter(line => !line.includes("_443._tcp.examplename.")).join("\n");

    /// write zonefile
    await writeTextFile(
      ["Dolo", domain, `${domain}.zone`].join(separator),
      zoneFileFiltered + zone, {
        dir: BaseDirectory.Document
      }
    );

    console.info(`WRITE | ${domain}.zone`);

    // TODO
    // : re-render view

    console.groupEnd();
  }

  async function processTopLevelDirectories(items: Array<{ path: string; }>) {
    const folders: Array<{
      date: Date;
      name: string;
      output: LooseObject;
      path: string;
      records: LooseObject;
      zone: Array<LooseObject>;
    }> = [];

    for (const item of items) {
      const { path } = item;

      if (path.includes(".DS_Store"))
        continue; // TODO: account for any hidden file(s)

      const { createdAt } = await metadata(path);
      const { output, records, zone } = await collectFiles(path);

      folders.push({
        date: createdAt,
        name: String(path.split(separator).pop()),
        output,
        path,
        records,
        zone
      });
    }

    /// sort reverse-chronologically by createdAt date
    folders.sort((a, b) => {
      return (a.date > b.date) ?
        1 :
        ((b.date > a.date) ? -1 : 0);
    }).reverse();

    return folders;
  }

  async function renderFolders() {
    const directoryList = await readDir("Dolo", { dir: BaseDirectory.Document, recursive: true });
    return await processTopLevelDirectories(directoryList);
  }

  function toggleNew() {
    readyForStep1.set(true);
  }
</script>

<style lang="scss">
  :root {
    --padding: calc(var(--line-height) / 2);
  }

  section {
    width: 100%; height: calc(100vh - 100px);
    top: 100px; left: 0;

    overflow-y: scroll;
    overscroll-behavior: contain;
    padding: 1.5rem var(--line-height) var(--line-height);
    position: absolute;
  }

  form > fieldset {
    &:not(:first-of-type) {
      padding-top: calc(var(--padding) * 3 - 2px);
      position: relative;

      &::before {
        width: 100%; height: var(--padding);
        top: -2px; left: 0;

        background-color: var(--dolo-palette-input-background);
        content: "";
        position: absolute;
      }
    }
  }

  fieldset {
    margin-bottom: 0;

    .long {
      width: calc(800px + var(--padding));
    }

    .plus-tiny {
      width: 700px;
    }

    .tiny {
      width: 100px;
    }

    label:not(.long):not(.tiny):not(.plus-tiny) {
      width: 400px;
    }

    input {
      margin-bottom: var(--padding);
    }
  }

  details {
    &:not([open]) {
      margin-bottom: var(--padding);
    }

    summary {
      padding-bottom: var(--padding);
      width: fit-content;
    }
  }

  hr {
    margin-top: var(--padding);
  }

  aside {
    align-items: center;
    display: flex;
    flex-direction: column;
    height: 100%;
    justify-content: center;
    margin: 0 auto;
    text-align: center;

    button {
      background-color: var(--dolo-palette-foreground);
      color: var(--dolo-palette-background);
      padding: 0.5rem calc(.75rem + 2px);
      text-transform: lowercase;
    }
  }
</style>

<section>
  {#await renderFolders() then value}
    {#if !value.length}
      <aside>
        <p>No exports created</p>
        <button on:click={toggleNew}>Get started</button>
      </aside>
    {/if}
    <form on:submit|preventDefault>
      {#each value as v, domainIndex}
        <fieldset>
          <fieldset>
            <label for={`domain_${v.name}`}>Domain
              <CopyButton text={v.name}/>
            </label>
            <input
              bind:value={v.name}
              id={`domain_${v.name}`}
              name={`domain_${v.name}`}
              readonly
              spellcheck=false
              type="text"/>

            <label for={`nameserver_${v.name}`}>Nameserver
              <CopyButton text={v.output.main.host}/>
            </label>
            <input
              bind:value={v.output.main.host}
              id={`nameserver_${v.name}`}
              name={`nameserver_${v.name}`}
              readonly
              spellcheck=false
              type="text"/>
          </fieldset>

          <details open={domainIndex === 0}>
            <summary>Wallet Records</summary>

            <fieldset>
              <label class="long" for={`wallet_ds_${v.name}`}>DS
                <CopyButton text={v.records.wallet.ds}/>
              </label>
              <input
                bind:value={v.records.wallet.ds}
                class="long"
                id={`wallet_ds_${v.name}`}
                name={`wallet_ds_${v.name}`}
                readonly
                spellcheck=false
                type="text"/>

              <br/>

              <label class="long" for={`wallet_glue4_${v.name}`}>GLUE4
                <CopyButton text={v.records.wallet.glue4}/>
              </label>
              <input
                bind:value={v.records.wallet.glue4}
                class="long"
                id={`wallet_glue4_${v.name}`}
                name={`wallet_glue4_${v.name}`}
                readonly
                spellcheck=false
                type="text"/>

              <br/>

              <label class="long" for={`wallet_ns_${v.name}`}>NS
                <CopyButton text={v.records.wallet.ns}/>
              </label>
              <input
                bind:value={v.records.wallet.ns}
                class="long"
                id={`wallet_ns_${v.name}`}
                name={`wallet_ns_${v.name}`}
                readonly
                spellcheck=false
                type="text"/>
            </fieldset>
          </details>

          <details open={domainIndex === 0}>
            <summary>DNS Records</summary>

            {#each v.zone as zone, zoneIndex}
              <fieldset>
                <label class="plus-tiny" for={`dns_domain_${zoneIndex}_${v.name}`}>Domain
                  <CopyButton text={zone.name}/>
                </label>
                <input
                  bind:value={zone.name}
                  class="plus-tiny"
                  id={`dns_domain_${zoneIndex}_${v.name}`}
                  name={`dns_domain_${zoneIndex}_${v.name}`}
                  readonly
                  spellcheck=false
                  type="text"/>

                <label class="tiny" for={`dns_ttl_${zoneIndex}_${v.name}`}>TTL
                  <CopyButton text={zone.ttl}/>
                </label>
                <input
                  bind:value={zone.ttl}
                  class="tiny"
                  id={`dns_ttl_${zoneIndex}_${v.name}`}
                  name={`dns_ttl_${zoneIndex}_${v.name}`}
                  readonly
                  spellcheck=false
                  type="text"/>

                <br/>

                <label class="tiny" for={`dns_type_${zoneIndex}_${v.name}`}>Type
                  <CopyButton text={zone.type}/>
                </label>
                <input
                  bind:value={zone.type}
                  class="tiny"
                  id={`dns_type_${zoneIndex}_${v.name}`}
                  name={`dns_type_${zoneIndex}_${v.name}`}
                  readonly
                  spellcheck=false
                  type="text"/>

                <label class="plus-tiny" for={`dns_value_${zoneIndex}_${v.name}`}>Value
                  <CopyButton text={zone.content}/>
                </label>
                <input
                  bind:value={zone.content}
                  class="plus-tiny"
                  id={`dns_value_${zoneIndex}_${v.name}`}
                  name={`dns_value_${zoneIndex}_${v.name}`}
                  readonly
                  spellcheck=false
                  type="text"/>

                {#if zone.type === "TLSA"}
                  <button on:click={() => regenerateCerts({ domain: v.name, nameserver: v.output.main.host })} type="button">Regenerate certs</button>
                {/if}
              </fieldset>

              <hr/>
            {/each}
          </details>
        </fieldset>
      {/each}
    </form>
  {:catch error}
    <p>Well&hellip;this is awkward.</p>
    <code>{String(error)}</code>
  {/await}
</section>
