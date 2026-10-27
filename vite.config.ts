import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Lets `dev:local` run beside other Vite apps (e.g. VITE_DEV_PORT=5180 API_PORT=8890).
const devPort = Number(process.env.VITE_DEV_PORT || 5173);
const apiPort = Number(process.env.API_PORT || 8888);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    port: devPort,
    // When running `vite` alone (without `netlify dev`) proxy API calls to the
    // functions server so the UI still works end to end.
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2020",
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
