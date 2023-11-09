<script lang="ts">
  /// import
  import { BaseDirectory, readTextFile, removeFile, writeTextFile } from "@tauri-apps/api/fs";
  import { onMount } from "svelte";
  import { sep as separator } from "@tauri-apps/api/path";
  import { parse as toml, stringify as writeToml } from "smol-toml";

  /// variable
  const configFile = [".config", "dolo", "config.toml"].join(separator);
  const themeChannel = new BroadcastChannel("theme_channel");
  let isViewNewSelected = true;
  let isViewExportSelected = false;
  let isThemeDoloSelected = true;
  let isThemeShakeStationSelected = false;
  let isThemeTheShakeSelected = false;

  /// type
  interface ConfigFile {
    config: {
      default_view: string; /// new | export
      theme: string;        /// dolo | shakestation | the-shake
    }
  }

  /// function
  async function handleThemeChange(event: any) {
    const { config } = toml(await readTextFile(configFile, { dir: BaseDirectory.Home })) as unknown as ConfigFile;
    const { value } = event.srcElement;

    switch(value) {
      case "shakestation": {
        isThemeDoloSelected = false;
        isThemeShakeStationSelected = true;
        isThemeTheShakeSelected = false;
        config.theme = value;
        break;
      }

      case "the-shake": {
        isThemeDoloSelected = false;
        isThemeShakeStationSelected = false;
        isThemeTheShakeSelected = true;
        config.theme = value;
        break;
      }

      case "dolo":
      default: {
        isThemeDoloSelected = true;
        isThemeShakeStationSelected = false;
        isThemeTheShakeSelected = false;
        config.theme = "dolo";
        break;
      }
    }

    try {
      themeChannel.postMessage(config.theme);

      /// write file
      await removeFile(configFile, { dir: BaseDirectory.Home }); /// updating the file creates issues…just delete and make anew
      await writeTextFile(configFile, `[config]\n${writeToml(config)}`, { dir: BaseDirectory.Home });
      console.info("Updated config file");
    } catch(_) {
      console.error(_);
      console.error("wtf bro");
    }
  }

  async function handleViewChange(event: any) {
    const { config } = toml(await readTextFile(configFile, { dir: BaseDirectory.Home })) as unknown as ConfigFile;
    const { value } = event.srcElement;

    if (value === "new") {
      isViewNewSelected = true;
      isViewExportSelected = false;
      config.default_view = "new";
    } else {
      isViewNewSelected = false;
      isViewExportSelected = true;
      config.default_view = "export";
    }

    /// write file
    await removeFile(configFile, { dir: BaseDirectory.Home }); /// updating the file creates issues…just delete and make anew
    await writeTextFile(configFile, `[config]\n${writeToml(config)}`, { dir: BaseDirectory.Home });
    console.info("Updated config file");
  }

  /// begin
  onMount(async() => {
    const { config } = toml(await readTextFile(configFile, { dir: BaseDirectory.Home })) as unknown as ConfigFile;

    /// set default view
    if (config.default_view === "new") {
      isViewNewSelected = true;
      isViewExportSelected = false;
    } else {
      isViewNewSelected = false;
      isViewExportSelected = true;
    }

    /// set theme
    switch(config.theme) {
      case "shakestation": {
        isThemeDoloSelected = false;
        isThemeShakeStationSelected = true;
        isThemeTheShakeSelected = false;
        themeChannel.postMessage(config.theme);
        break;
      }

      case "the-shake": {
        isThemeDoloSelected = false;
        isThemeShakeStationSelected = false;
        isThemeTheShakeSelected = true;
        themeChannel.postMessage(config.theme);
        break;
      }

      case "dolo":
      default: {
        isThemeDoloSelected = true;
        isThemeShakeStationSelected = false;
        isThemeTheShakeSelected = false;
        themeChannel.postMessage("dolo");
        break;
      }
    }
  });
</script>

<style lang="scss">
  section {
    align-items: center;
    background-color: var(--background-color);
    border-top: 1px solid;
    color: var(--foreground-color);
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 100vh;

    @media (prefers-color-scheme: dark) {
      border-top-color: var(--inc-yin);
    }

    @media (prefers-color-scheme: light) {
      border-top-color: var(--inc-gray-2);
    }
  }

  fieldset {
    align-items: end;
    display: flex;
    flex-direction: row;
    font-size: 0.8rem;

    p {
      text-align: right;
      width: 100px;
    }

    label {
      color: var(--foreground-color) !important;
      position: relative;
      text-align: center;

      &:not(:first-child) {
        margin-left: var(--line-height);
      }
    }

    [type=radio] {
      width: 100%; height: 100%;
      top: 0; left: 0;

      opacity: 0;
      position: absolute;

      &:checked {
        + img {
          outline: solid 2px var(--dolo-palette-accent);
          outline-offset: 2px;
        }

        + img + span {
          font-weight: 600;
        }
      }
    }

    img {
      width: 100px; height: 65px;

      border-radius: 0.25rem;
      margin: 0 auto calc(var(--line-height) / 4);
      object-fit: cover;
      object-position: top;
    }
  }
</style>

<section>
  <form on:submit|preventDefault>
    <fieldset>
      <p>Default view:</p>

      <label class="radio-label">
        <input
          checked={isViewNewSelected}
          name="view"
          on:click={handleViewChange}
          type="radio"
          value="new"/>
        {#if isThemeDoloSelected}
          <img alt="new" src="/media/settings/new-dolo.png"/>
        {/if}
        {#if isThemeShakeStationSelected}
          <img alt="new" src="/media/settings/new-shakestation.png"/>
        {/if}
        {#if isThemeTheShakeSelected}
          <img alt="new" src="/media/settings/new-the-shake.png"/>
        {/if}
        <span>New</span>
      </label>

      <label class="radio-label">
        <input
          checked={isViewExportSelected}
          name="view"
          on:click={handleViewChange}
          type="radio"
          value="export"/>
        {#if isThemeDoloSelected}
          <img alt="export" src="/media/settings/export-dolo.png"/>
        {/if}
        {#if isThemeShakeStationSelected}
          <img alt="export" src="/media/settings/export-shakestation.png"/>
        {/if}
        {#if isThemeTheShakeSelected}
          <img alt="export" src="/media/settings/export-the-shake.png"/>
        {/if}
        <span>Export</span>
      </label>
    </fieldset>

    <fieldset>
      <p class="radio-label">Theme:</p>

      <label class="radio-label">
        <input
          checked={isThemeDoloSelected}
          on:click={handleThemeChange}
          type="radio"
          name="theme"
          value="dolo"/>
        {#if isViewNewSelected}
          <img alt="new" src="/media/settings/new-dolo.png"/>
        {/if}
        {#if isViewExportSelected}
          <img alt="new" src="/media/settings/export-dolo.png"/>
        {/if}
        <span>Dolo</span>
      </label>

      <label class="radio-label">
        <input
          checked={isThemeShakeStationSelected}
          on:click={handleThemeChange}
          name="theme"
          type="radio"
          value="shakestation"/>
        {#if isViewNewSelected}
          <img alt="export" src="/media/settings/new-shakestation.png"/>
        {/if}
        {#if isViewExportSelected}
          <img alt="new" src="/media/settings/export-shakestation.png"/>
        {/if}
        <span>Shakestation</span>
      </label>

      <label class="radio-label">
        <input
          checked={isThemeTheShakeSelected}
          on:click={handleThemeChange}
          name="theme"
          type="radio"
          value="the-shake"/>
        {#if isViewNewSelected}
          <img alt="export" src="/media/settings/new-the-shake.png"/>
        {/if}
        {#if isViewExportSelected}
          <img alt="new" src="/media/settings/export-the-shake.png"/>
        {/if}
        <span>The Shake</span>
      </label>
    </fieldset>
  </form>
</section>
