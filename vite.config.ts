import { defineConfig } from "vite";

// Builds src/ into public/, which Netlify publishes.
export default defineConfig({
  root: "src",
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
