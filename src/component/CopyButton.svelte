<script lang="ts">
  /// import
  import { writeText } from "@tauri-apps/api/clipboard";

  /// var
  const pathCopy = "m21 8h-2c-.552 0-1 .447-1 1s.448 1 1 1h2c.551 0 1 .448 1 1v10c0 .552-.449 1-1 1h-10c-.551 0-1-.448-1-1v-2c0-.553-.448-1-1-1s-1 .447-1 1v2c0 1.654 1.346 3 3 3h10c1.654 0 3-1.346 3-3v-10c0-1.654-1.346-3-3-3zm-5 5v-10c0-1.654-1.346-3-3-3h-10c-1.654 0-3 1.346-3 3v10c0 1.654 1.346 3 3 3h10c1.654 0 3-1.346 3-3zm-14 0v-10c0-.552.449-1 1-1h10c.551 0 1 .448 1 1v10c0 .552-.449 1-1 1h-10c-.551 0-1-.448-1-1z";
  const pathCheck = "m20.641 5.232c-.427-.354-1.055-.295-1.409.128l-9.425 11.31-5.252-3.501c-.461-.308-1.081-.183-1.387.277-.307.459-.183 1.081.277 1.387l6 4c.17.112.363.167.554.167.288 0 .572-.124.77-.36l10-12c.353-.424.295-1.055-.128-1.408z";
  let path = pathCopy;

  /// export
  export let text: unknown;

  /// function
  async function handleClick() {
    await writeText(String(text));
    path = pathCheck;

    setTimeout(() => {
      path = pathCopy;
    }, 1500);
  }
</script>

<style lang="scss">
  button {
    width: 2.25rem; height: 2rem;
    top: 0; right: 0;

    align-items: center;
    background-color: transparent !important;
    color: var(--dolo-palette-input-foreground) !important;
    display: flex;
    justify-content: center;
    padding: 0;
    position: absolute;

    svg {
      width: 1rem; height: 1rem;
      pointer-events: none;
    }
  }
</style>

<button on:click={handleClick}>
  <svg fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d={path}/>
  </svg>
</button>
