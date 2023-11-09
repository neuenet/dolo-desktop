<script lang="ts">
  /// import
  import { BaseDirectory, readDir, readTextFile } from "@tauri-apps/api/fs";
  import { metadata } from "tauri-plugin-fs-extra-api";
  import { parseZone } from "dnsz";
  import { sep as separator } from "@tauri-apps/api/path";
  import { parse as toml } from "smol-toml";

  /// component
  import CopyButton from "./CopyButton.svelte";

  /// util
  import type { LooseObject } from "../utility/interface";

  /// function
  async function collectFiles(directory: string) {
    const domain = directory.split(separator).pop();

    const outputFile = [directory, "output.toml"].join(separator);
    const recordsFile = [directory, "records.toml"].join(separator);
    const zoneFile = [directory, `db.${domain}`].join(separator);

    const outputFileContent = await readTextFile(outputFile, { dir: BaseDirectory.Document });
    const recordsFileContent = await readTextFile(recordsFile, { dir: BaseDirectory.Document });
    const { records: zone } = parseZone(await readTextFile(zoneFile, { dir: BaseDirectory.Document }));

    return {
      output: toml(outputFileContent),
      records: toml(recordsFileContent),
      zone
    };
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
    summary {
      padding-bottom: var(--padding);
      width: fit-content;
    }
  }

  hr {
    margin-top: var(--padding);
  }
</style>

<section>
  {#await renderFolders() then value}
    <form on:submit|preventDefault>
      {#each value as v, domainIndex}
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
            </fieldset>

            <hr/>
          {/each}
        </details>

        <hr/>
      {/each}
    </form>
  {:catch error}
    <p>Well&hellip;this is awkward.</p>
    <code>{String(error)}</code>
  {/await}
</section>
