import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // When running `vite` alone (without `netlify dev`) proxy API calls to the
    // functions server so the UI still works end to end.
    proxy: {
      "/api": {
        target: "http://localhost:8888",
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
