


/// import

import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";



/// export

export default defineConfig(async () => ({
  // use top-level await | https://github.com/vitejs/vite/issues/6985#issuecomment-1044375490
  build: { target: "esnext" },
  // prevent vite from obscuring rust errors
  clearScreen: false,
  // to make use of `TAURI_DEBUG` and other env variables
  // https://tauri.studio/v1/api/config#buildconfig.beforedevcommand
  envPrefix: ["VITE_", "TAURI_"],
  plugins: [svelte()],
  // tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true
  }
}));



/// https://vitejs.dev/config
