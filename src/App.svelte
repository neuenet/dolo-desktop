<script context="module">
  /// component
  import Settings from "./component/Settings.svelte";

  /// variable
  let isSettingsWindow = false;

  /// function
  async function init() {
    /// setup Settings window
    const title = await appWindow.title();

    if (title.toLowerCase() === "settings")
      isSettingsWindow = true;
  }

  /// program
  await init();
</script>

<script lang="ts">
  /// import
  import { appWindow } from "@tauri-apps/api/window";
  import { BaseDirectory, createDir, exists, readTextFile, writeTextFile } from "@tauri-apps/api/fs";
  import dedent from "dedent";
  import { open } from "@tauri-apps/api/shell";
  import { documentDir, sep as separator } from "@tauri-apps/api/path";
  import { parse as toml } from "smol-toml";

  /// util
  import { entry, readyForStep1, readyForStep2 } from "./utility/store";

  /// component
  import ExportInfo from "./component/ExportInfo.svelte";
  import NewExport from "./component/NewExport.svelte";

  /// variable
  const configFile = [".config", "dolo", "config.toml"].join(separator);
  const configFolder = [".config", "dolo"].join(separator);
  const themeChannel = new BroadcastChannel("theme_channel");
  let exportInfoSelected = false;
  let newExportSelected = true;
  let chosenTheme = "dolo";

  /// type
  interface ConfigFile {
    config: {
      default_view: string; /// new | export
      theme: string;        /// dolo | shakestation | the-shake
    }
  }

  /// function
  async function begin() {
    const doesConfigDirectoryExist = await exists(configFolder, { dir: BaseDirectory.Home });
    const doesConfigFileExist = await exists(configFile, { dir: BaseDirectory.Home });
    const doesExportDirectoryExist = await exists("Dolo", { dir: BaseDirectory.Document });

    if (!doesConfigDirectoryExist) {
      await createDir(configFolder, { dir: BaseDirectory.Home, recursive: true });
      console.info("Created config directory");
    }

    if (!doesConfigFileExist) {
      const configFileContents = dedent`
        [config]
        default_view = "new"
        theme = "dolo"
      `;

      await writeTextFile(configFile, configFileContents, { dir: BaseDirectory.Home });
      console.info("Created config file");
    }

    if (!doesExportDirectoryExist) {
      await createDir("Dolo", { dir: BaseDirectory.Document, recursive: true });
      console.info("Created export directory");
    }

    const { config } = toml(await readTextFile(configFile, { dir: BaseDirectory.Home })) as unknown as ConfigFile;

    /// set theme
    chosenTheme = config.theme;

    /// set default view
    if (config.default_view === "export")
      toggleNavSelection("view");
    else
      toggleNavSelection("new");
  }

  async function openFolder() {
    const documentDirectoryPath = await documentDir();
    const exportFolder = [documentDirectoryPath, "Dolo"].join(separator);

    await open(exportFolder);
  }

  function toggleNavSelection(element: MouseEvent|string) {
    let id = element;

    if (typeof element !== "string")
      id = (element.target as HTMLElement).id;

    switch(id) {
      case "view": {
        exportInfoSelected = true;
        newExportSelected = false;
        readyForStep1.set(false);
        break;
      }

      default:
      case "new": {
        exportInfoSelected = false;
        newExportSelected = true;
        readyForStep2.set(false);
        /// reset input fields
        entry.set({ domain: "", nameserver1: "" });
        break;
      }
    }
  }

  /// reactive
  readyForStep1.subscribe(value => {
    if (value === true)
      toggleNavSelection("new");
  });

  readyForStep2.subscribe(value => {
    if (value === true)
      toggleNavSelection("view");
  });

  themeChannel.onmessage = (event: MessageEvent) => {
    const { data } = event;
    let backgroundColor: string;
    chosenTheme = data;

    /// set variable on body element to be the same as main element
    /// so over-scroll color is the same

    switch(chosenTheme) {
      case "shakestation": {
        backgroundColor = "#2d2d2d";
        break;
      }

      case "the-shake": {
        backgroundColor = "#1e2131";
        break;
      }

      case "dolo":
      default: {
        backgroundColor = "var(--inc-yang)";
        break;
      }
    }

    document.querySelector("body")!.style.setProperty("--dolo-palette-background", backgroundColor);
  };

  /// program
  begin();
</script>

<style lang="scss">
  @import "./sass/mixin";

  @include font(400, "/type/golos-text", "dolo sans");
  @include font(500, "/type/golos-text", "dolo sans");
  @include font(600, "/type/golos-text", "dolo sans");
  @include font(700, "/type/golos-text", "dolo sans");
  @include font(800, "/type/golos-text", "dolo sans");
  @include font(900, "/type/golos-text", "dolo sans");

  @include font-plus-italics(400, "/type/plex-mono", "dolo mono");
  @include font-plus-italics(500, "/type/plex-mono", "dolo mono");
  @include font-plus-italics(600, "/type/plex-mono", "dolo mono");
  @include font-plus-italics(700, "/type/plex-mono", "dolo mono");

  :root {
    --dolo-palette-accent: var(--inc-blue-4);
    --dolo-palette-background: var(--inc-yang);
    --dolo-palette-failure: var(--inc-red-4);
    --dolo-palette-foreground: var(--inc-yin);
    --dolo-palette-input-background: var(--inc-gray-1);
    --dolo-palette-input-foreground: var(--inc-gray-5);
    --dolo-palette-success: var(--inc-green-4);

    --font-size: 16px;
    --mono-font: "dolo mono";
    --sans-font: "dolo sans";
  }

  :global(*) {
    @include no-user-select;
    cursor: default;
  }

  :global(html),
  :global(body) {
    min-height: 100vh;
  }

  :global(html) {
    letter-spacing: -0.01rem;
    min-width: 320px;
    overflow: hidden;
    position: relative;
  }

  :global([data-theme="shakestation"]) {
    --dolo-palette-accent: #94f9c3;
    --dolo-palette-background: #2d2d2d;
    --dolo-palette-foreground: #fff;
    --dolo-palette-input-background: #282828;
    --dolo-palette-input-foreground: #fff;
  }

  :global([data-theme="the-shake"]) {
    --dolo-palette-accent: #64dec1;
    --dolo-palette-background: #1e2131;
    --dolo-palette-foreground: #fafafa;
    --dolo-palette-input-background: #2dba98;
    --dolo-palette-input-foreground: #1e2131;
  }

  :global(body) {
    background-color: var(--dolo-palette-background);
    border-top-color: var(--dolo-palette-foreground);
    color: var(--dolo-palette-foreground);
    font-family: var(--sans-font);
    padding: 0;
  }

  :global(a),
  :global(input) {
    transition: auto;
  }

  :global(a),
  :global(fieldset button:disabled) {
    cursor: default;
  }

  :global(input[type="text"]) {
    cursor: text;
    font-family: var(--mono-font);
    font-variant-numeric: slashed-zero;
  }

  [data-tauri-drag-region] {
    width: 100vw; height: 1.5rem;
    top: 0; left: 0;

    position: relative;
    z-index: 600;
  }

  main {
    background-color: var(--dolo-palette-background);
    color: var(--dolo-palette-foreground);
    min-height: calc(100vh - 1.5rem); // minus tauri-drag-region height
  }

  nav {
    width: 100%; height: 100px;
    top: 0; left: 0;

    background-color: var(--dolo-palette-background);
    border-bottom: 5px solid;
    border-bottom-color: var(--dolo-palette-foreground);
    display: flex;
    padding: var(--line-height) var(--line-height) 0;
    position: fixed;
    z-index: 100;

    button {
      &:not(.logo) {
        width: 3rem; height: 100%;

        svg {
          pointer-events: none;
          width: 1.5rem;
        }
      }

      &.logo {
        align-items: baseline;
        align-self: center;
        background-position: 0 center;
        background-repeat: no-repeat;
        bottom: -3px;
        display: flex;
        flex: 1;
        flex-direction: column;
        height: 3rem;
        justify-content: center;
        position: relative;

        svg {
          min-width: 150px;
        }
      }

      &:not(.selected) {
        color: currentColor;
      }

      &.selected {
        background-color: var(--dolo-palette-foreground);
        color: var(--dolo-palette-background);
      }
    }
  }
</style>

{#if !isSettingsWindow}
  <section data-tauri-drag-region></section>
{/if}

{#if isSettingsWindow}
  <main style="padding-top: 0;">
    <Settings/>
  </main>
{:else}
  <main style="padding-top: 100px;" data-theme={chosenTheme}>
    <nav>
      <button class="logo">
        <svg fill="currentColor" viewBox="0 0 1200 300" xmlns="http://www.w3.org/2000/svg">
          <path d="M274.56, 210.48l0, 40.32l-218.88, -0l0, -161.28l40.32, -0l0, 120.96l178.56, -0Zm-178.56, -120.96l0, -40.32l158.4, -0c33.408, -0 60.48, 27.072 60.48, 60.48l0, 100.8l-40.32, -0l0, -100.8c0, -11.232 -8.928, -20.16 -20.16, -20.16l-158.4, -0Zm460.8, 120.96l0, 40.32l-158.4, -0c-33.408, -0 -60.48, -27.072 -60.48, -60.48l0, -100.8l40.32, -0l0, 100.8c0, 11.232 8.928, 20.16 20.16, 20.16l158.4, -0Zm-178.56, -120.96l0, -40.32l158.4, -0c33.12, -0 60.48, 27.072 60.48, 60.48l0, 100.8l-40.32, -0l0, -100.8c0, -11.232 -9.216, -20.16 -20.16, -20.16l-158.4, 0Zm725.76, 120.96l0, 40.32l-158.4, 0c-33.408, 0 -60.48, -27.072 -60.48, -60.48l0, -100.8l40.32, 0l0, 100.8c0, 11.232 8.928, 20.16 20.16, 20.16l158.4, -0Zm-178.56, -120.96l0, -40.32l158.4, 0c33.12, 0 60.48, 27.072 60.48, 60.48l0, 100.8l-40.32, 0l-0, -100.8c-0, -11.232 -9.216, -20.16 -20.16, -20.16l-158.4, 0Zm-244.8, 161.28c-33.408, 0 -60.48, -27.072 -60.48, -60.48l0, -141.12l40.32, 0l-0, 141.12c-0, 11.232 8.928, 20.16 20.16, 20.16l181.44, 0l0, 40.32l-181.44, 0Z"/>
        </svg>
      </button>

      <button
        class:selected={newExportSelected}
        id="new"
        on:click={toggleNavSelection}>
        <svg fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="m16 11h-3v-3c0-.552-.448-1-1-1s-1 .448-1 1v3h-3c-.552 0-1 .448-1 1s.448 1 1 1h3v3c0 .552.448 1 1 1s1-.448 1-1v-3h3c.552 0 1-.448 1-1s-.448-1-1-1zm4.485-7.485c-4.678-4.678-12.292-4.679-16.971 0-4.678 4.679-4.678 12.292 0 16.971 2.339 2.339 5.413 3.509 8.485 3.509s6.146-1.169 8.485-3.509c4.68-4.679 4.68-12.293.001-16.971zm-1.414 15.556c-3.899 3.898-10.244 3.899-14.143 0-3.898-3.899-3.898-10.244 0-14.143 1.95-1.949 4.511-2.923 7.072-2.923s5.122.975 7.071 2.924c3.899 3.899 3.899 10.243 0 14.142z"/>
        </svg>
      </button>

      <button
        class:selected={exportInfoSelected}
        id="view"
        on:click={toggleNavSelection}>
          <svg fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="m15 11h-6c-.552 0-1 .447-1 1s.448 1 1 1h6c.552 0 1-.447 1-1s-.448-1-1-1zm0-5h-6c-.552 0-1 .447-1 1s.448 1 1 1h6c.552 0 1-.447 1-1s-.448-1-1-1zm8 11h-3v-14c0-1.654-1.346-3-3-3h-14c-1.654 0-3 1.346-3 3v5c0 .553.448 1 1 1s1-.447 1-1v-5c0-.552.449-1 1-1s1 .448 1 1v18c0 1.653 1.345 2.999 2.999 3h14.001c1.654 0 3-1.346 3-3v-3c0-.553-.448-1-1-1zm-15 1v3c0 .552-.449 1-1 1s-1-.448-1-1v-18c0-.352-.072-.686-.184-1h11.184c.551 0 1 .448 1 1v14h-9c-.552 0-1 .447-1 1zm14 3c0 .552-.449 1-1 1h-11.171c.11-.312.171-.649.171-1v-2h12z"/>
          </svg>
      </button>

      <button id="open" on:click={openFolder}>
        <svg fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="m23.476 11.244c-.559-.776-1.485-1.24-2.476-1.24v-2.004c0-1.654-1.346-3-3-3h-5.586l-2.707-2.707c-.187-.188-.442-.293-.707-.293h-6c-1.654 0-3 1.346-3 3v17c0 .013.007.024.007.037.004.117.024.231.069.34.006.015.015.027.022.041.024.053.048.106.082.154.026.037.059.067.089.1.015.016.028.033.044.049.081.077.173.138.273.184.022.01.043.016.066.025.111.041.227.07.348.07h18c.392 0 .748-.229.911-.586l3.91-8.607c.014-.032.027-.064.038-.098.28-.84.141-1.739-.383-2.465zm-21.476-6.244c0-.551.449-1 1-1h5.586l2.707 2.707c.187.188.442.293.707.293h6c.551 0 1 .449 1 1v2.004h-12.523c-1.315 0-2.464.799-2.85 1.958l-1.627 4.423zm19.974 8.036-3.618 7.964h-15.923l3.082-8.377c.122-.365.517-.619.962-.619h14.521c.351 0 .67.153.855.409.098.136.196.352.121.623z"/>
        </svg>
      </button>
    </nav>

    {#if newExportSelected}
      <NewExport/>
    {/if}

    {#if exportInfoSelected}
      <ExportInfo/>
    {/if}
  </main>
{/if}
