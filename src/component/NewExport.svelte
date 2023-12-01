<script lang="ts">
  /// import
  import { BaseDirectory, createDir, exists, readDir, readTextFile, removeFile, writeTextFile } from "@tauri-apps/api/fs";
  import { parse as toml } from "smol-toml";
  import { sep as separator } from "@tauri-apps/api/path";
  import * as x509 from "@peculiar/x509";

  /// util
  import { AuthNS } from "../utility/authns";
  import { default as bns } from "../utility/bns";
  import { entry, readyForStep2 } from "../utility/store";
  import { formatTextToWidth } from "../utility/format-text-width";
  import { generateSerial } from "../utility/generate-serial";
  import { getNextYearDate } from "../utility/date-next-year";
  import { getYesterdayDate } from "../utility/date-yesterday";
  import { toZone } from "../utility/to-zone";
  import type { ConfigFile, LooseObject } from "../utility/interface";

  /// component
  import ProgressBar from "./ProgressBar.svelte";

  /// variable
  const { dnssec } = bns;
  const { ED25519 } = dnssec.algs;
  const KSK = 1 << 0;
  const ZONE = 1 << 8;
  let domain = ($entry as LooseObject).domain || "";
  let isDomainValid = false;
  let isNameserver1Valid = false;
  let nameserver1 = ($entry as LooseObject).nameserver1 || "";
  let progress: ProgressBar;

  /// function
  async function generateFiles(event: any) {
    event.preventDefault();

    entry.set({ domain, nameserver1 });
    progress.setWidthRatio(0);

    await generateCerts();
    await generateKSKKeys();
    await generateZSKKeys();
    await generateOutputFile();
    await generateZoneFile();

    progress.complete();
    readyForStep2.set(true);
  }

  async function generateCerts() {
    console.group("generateCerts()");
    const { domain, nameserver1 } = $entry;

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
          { type: "ip", value: nameserver1 }
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
    console.groupEnd();
    progress.setWidthRatio(0.2);
  }

  async function generateKSKKeys() {
    console.group("generateKSKKeys()");
    const { domain, nameserver1 } = $entry;

    const kskFolder = ["Dolo", domain, "ksk"].join(separator);
    const doesKSKDirectoryExist = await exists(kskFolder, { dir: BaseDirectory.Document });

    if (!doesKSKDirectoryExist) {
      await createDir(kskFolder, { dir: BaseDirectory.Document, recursive: true });
    } else {
      /// clear out directory because filenames change on key generation…
      /// repeat regenerations make a bulky directory
      const directoryList = await readDir(kskFolder, { dir: BaseDirectory.Document, recursive: true });

      for (const item of directoryList) {
        // TODO: account for any hidden file(s)
        if (item.path.includes(".DS_Store"))
          continue;
        else
          await removeFile(item.path, { dir: BaseDirectory.Document });
      }
    }

    /// writePrivate

    const _kpriv = dnssec.createPrivate(ED25519, 4096);
    const _kkey = dnssec.makeKey(`${domain}.`, ED25519, _kpriv, ZONE | KSK);

    const _kskPrivateFilename = privFile(
      _kkey.name,
      _kkey.data.algorithm,
      _kkey.data.keyTag()
    );

    await writeTextFile(
      [kskFolder, _kskPrivateFilename].join(separator),
      encodePrivate(_kpriv, getCurrentDateTime()), {
        dir: BaseDirectory.Document
      }
    );

    console.info(`WRITE | ${_kskPrivateFilename}`);

    /// writePublic

    const _kskPublicFilename = pubFile(
      _kkey.name,
      _kkey.data.algorithm,
      _kkey.data.keyTag()
    );

    await writeTextFile(
      [kskFolder, _kskPublicFilename].join(separator),
      _kkey.toString(), {
        dir: BaseDirectory.Document
      }
    );

    console.info(`WRITE | ${_kskPublicFilename}`);

    const _kds = dnssec.createDS(_kkey);

    const recordRoot = `${domain}. ${_kds.ttl} IN DS ${_kds.data.keyTag} ${_kds.data.algorithm} ${_kds.data.digestType} ${_kds.data.digest.toString("hex").toUpperCase()}`;
    const recordDS = recordRoot.split("DS")[1].trim();
    const recordGlue = `ns.${domain}. ${nameserver1}`;
    const recordNS = `ns.${domain}.`;

    const recordsFileContents = [
      "[root]",
      `record = "${recordRoot}"\n`,
      "[wallet]",
      `ds     = "${recordDS}"`,
      `glue4  = "${recordGlue}"`,
      `ns     = "${recordNS}"`
    ].join("\n") + "\n";

    await writeTextFile(
      ["Dolo", domain, "records.toml"].join(separator),
      recordsFileContents, {
        dir: BaseDirectory.Document
      }
    );

    console.info("WRITE | records.toml");
    console.groupEnd();
    progress.setWidthRatio(0.4);
  }

  async function generateOutputFile() {
    console.group("generateOutputFile()");
    const { domain, nameserver1 } = $entry;
    const kskFolder = ["Dolo", domain, "ksk"].join(separator);
    const zskFolder = ["Dolo", domain, "zsk"].join(separator);
    let kskPublicFilename = "";
    let kskPrivateFilename = "";
    let zskPublicFilename = "";
    let zskPrivateFilename = "";

    const kskDirectoryList = await readDir(kskFolder, { dir: BaseDirectory.Document, recursive: true });
    const zskDirectoryList = await readDir(zskFolder, { dir: BaseDirectory.Document, recursive: true });

    for (const item of kskDirectoryList) {
      if (item.path.endsWith(".key"))
        kskPublicFilename = item.path.split(`ksk${separator}`)[1];

      if (item.path.endsWith(".private"))
        kskPrivateFilename = item.path.split(`ksk${separator}`)[1];
    }

    for (const item of zskDirectoryList) {
      if (item.path.endsWith(".key"))
        zskPublicFilename = item.path.split(`zsk${separator}`)[1];

      if (item.path.endsWith(".private"))
        zskPrivateFilename = item.path.split(`zsk${separator}`)[1];
    }

    const outputFileContent = [
      "[main]",
      `domain  = "${domain}."`,
      `host    = "${nameserver1}"\n`,
      "[ksk]",
      `public  = "${kskPublicFilename}"`,
      `private = "${kskPrivateFilename}"\n`,
      "[zsk]",
      `public  = "${zskPublicFilename}"`,
      `private = "${zskPrivateFilename}"`
    ].join("\n");

    const outputFile = ["Dolo", domain, "output.toml"].join(separator);
    await writeTextFile(outputFile, outputFileContent, { dir: BaseDirectory.Document });

    console.info("WRITE | output.toml");
    console.groupEnd();
    progress.setWidthRatio(0.8);
  }

  async function generateZoneFile() {
    console.group("generateZoneFile()");
    const { domain: name } = $entry;
    let records = [];

    const originalFileContent = await readTextFile(["Dolo", name, "output.toml"].join(separator), { dir: BaseDirectory.Document });
    const { ksk, main, zsk } = toml(originalFileContent) as unknown as ConfigFile;
    const { host } = main; /// domain: domainPlusDot
    const { private: privateKSK, public: publicKSK } = ksk;
    const { private: privateZSK, public: publicZSK } = zsk;

    const authns = new AuthNS({
      domain: name,
      host,
      kskkey: publicKSK,
      kskpriv: privateKSK,
      test: false,
      zskkey: publicZSK,
      zskpriv: privateZSK
    });

    await authns.init();

    authns.server.zone.names.forEach(recordMap => {
      recordMap.rrs.forEach(rr => records = records.concat(rr));
      recordMap.sigs.forEach(rr => records = records.concat(rr));
    });

    const zone = toZone(records);

    /// write zonefile
    await writeTextFile(["Dolo", name, `${name}.zone`].join(separator), zone, { dir: BaseDirectory.Document });

    console.info(`WRITE | ${name}.zone`);
    console.groupEnd();
  }

  async function generateZSKKeys() {
    console.group("generateZSKKeys()");
    const { domain } = $entry;

    const zskFolder = ["Dolo", domain, "zsk"].join(separator);
    const doesZSKDirectoryExist = await exists(zskFolder, { dir: BaseDirectory.Document });

    if (!doesZSKDirectoryExist) {
      await createDir(zskFolder, { dir: BaseDirectory.Document, recursive: true });
    } else {
      /// clear out directory because filenames change on key generation…
      /// repeat regenerations make a bulky directory
      const directoryList = await readDir(zskFolder, { dir: BaseDirectory.Document, recursive: true });

      for (const item of directoryList) {
        // TODO: account for any hidden file(s)
        if (item.path.includes(".DS_Store"))
          continue;
        else
          await removeFile(item.path, { dir: BaseDirectory.Document });
      }
    }

    /// writePrivate

    const _zpriv = dnssec.createPrivate(ED25519, 4096);
    const _zkey = dnssec.makeKey(`${domain}.`, ED25519, _zpriv, ZONE);
    const _zskPrivateFilename = privFile(_zkey.name, _zkey.data.algorithm, _zkey.data.keyTag());

    await writeTextFile(
      [zskFolder, _zskPrivateFilename].join(separator),
      encodePrivate(_zpriv, getCurrentDateTime()), {
        dir: BaseDirectory.Document
      }
    );

    console.info(`WRITE | ${_zskPrivateFilename}`);

    /// writePublic

    const _zskPublicFilename = pubFile(_zkey.name, _zkey.data.algorithm, _zkey.data.keyTag());

    await writeTextFile(
      [zskFolder, _zskPublicFilename].join(separator),
      _zkey.toString(), {
        dir: BaseDirectory.Document
      }
    );

    console.info(`WRITE | ${_zskPublicFilename}`);
    console.groupEnd();
    progress.setWidthRatio(0.6);
  }

  function validateDomain(suppliedDomain: string): undefined {
    if (suppliedDomain.length > 0)
      isDomainValid = true;
    else
      isDomainValid = false;
  }

  function validateNameserver1(ip: string): undefined {
    if (validateIPAddress(ip))
      isNameserver1Valid = true;
    else
      isNameserver1Valid = false;
  }

  /// helper

  function encodePrivate(raw: Uint8Array, time: number) {
    return [
      "Private-key-format: v1.3",
      "Algorithm: 15 (ED25519)",
      `PrivateKey: ${uint8ArrayToBase64(raw)}`,
      `Created: ${time}`,
      `Publish: ${time}`,
      `Activate: ${time}`
    ].join("\n") + "\n";
  }

  function getCurrentDateTime(): number {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    return Number(`${year}${month}${day}${hours}${minutes}${seconds}`);
  }

  function pad(num: number, len: number) {
    let str = num.toString(10);

    while (str.length < len)
      str = `0${str}`;

    return str;
  }

  function privFile(name: string, alg: number, tag: number) {
    return `K${name.toLowerCase()}+${pad(alg, 3)}+${pad(tag, 5)}.private`;
  }

  function pubFile(name: string, alg: number, tag: number) {
    return `K${name.toLowerCase()}+${pad(alg, 3)}+${pad(tag, 5)}.key`;
  }

  function uint8ArrayToBase64(uint8Array: Uint8Array): string {
    // Create a binary string from the Uint8Array
    let binaryString = "";

    for (let i = 0; i < uint8Array.length; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }

    // Use btoa to convert the binary string to base64
    return btoa(binaryString);
  }

  function validateIPAddress(ip: string) {
    return validateIPv4(ip) || validateIPv6(ip);
  }

  function validateIPv4(ip: string) {
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = ip.match(ipv4Regex);

    if (!match)
      return false;

    for (let i = 1; i <= 4; i++) {
      const octet = parseInt(match[i], 10);

      if (octet < 0 || octet > 255)
        return false;
    }

    return true;
  }

  function validateIPv6(ip: string) {
    // const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){1,7}(:[0-9a-fA-F]{1,4}){1,7}$/; /// accounts for double colons
    return ipv6Regex.test(ip);
  }

  /// dynamic variable
  $: proceed = () => {
    if (isDomainValid && isNameserver1Valid)
      return true;
    else
      return false;
  }
</script>

<style lang="scss">
  form {
    fieldset {
      padding: 0 var(--line-height) var(--line-height);

      &:not(:last-child) {
        border-bottom: 1px solid;
        border-bottom-color: var(--dolo-palette-input-background);
        padding-bottom: 1.5rem;
      }

      button:not(:disabled) {
        background-color: var(--dolo-palette-foreground);
        color: var(--dolo-palette-background);
      }
    }

    input.valid {
      border-color: var(--dolo-palette-success);
    }
  }
</style>

<ProgressBar bind:this={progress}/>

<form>
  <fieldset>
    <label for="domain">Domain</label>
    <!-- svelte-ignore a11y-autofocus -->
    <input
      autofocus
      bind:value={domain}
      class:valid={isDomainValid}
      id="domain"
      name="domain"
      on:keyup={validateDomain(domain)}
      spellcheck=false
      type="text"/>

    <br/><br/>

    <label for="nameserver1">Nameserver</label>
    <input
      bind:value={nameserver1}
      class:valid={isNameserver1Valid}
      id="nameserver1"
      name="nameserver1"
      on:keyup={validateNameserver1(nameserver1)}
      spellcheck=false
      type="text"/>
  </fieldset>

  <fieldset>
    <button
      disabled={!proceed()}
      on:click={generateFiles}
      type="submit">Generate</button>
  </fieldset>
</form>
