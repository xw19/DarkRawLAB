import { defineConfig } from "vite";

declare const process: { env: { BASE_PATH?: string } };

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  // libraw-wasm ships a pre-bundled ESM build that spins up its own module
  // Worker via `new Worker(new URL('./worker.js', import.meta.url))` and loads
  // a .wasm asset. Pre-bundling it with esbuild rewrites those URLs and breaks
  // the worker/wasm resolution, so keep it out of optimizeDeps and let Vite's
  // own worker/asset handling emit them.
  optimizeDeps: {
    exclude: ["libraw-wasm"],
  },
  worker: {
    format: "es",
  },
  server: {
    host: true, // expose on LAN so we can test on a real phone
  },
});
