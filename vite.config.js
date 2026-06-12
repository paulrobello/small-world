// Vite config — dev server with HMR and optimized production builds.
// three.js and simplex-noise are local npm packages, bundled and tree-shaken.
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

export default {
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  server: {
    port: 1999,
    open: true,
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 950,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        // Split rarely-changing vendor libraries into their own stable-hash
        // chunks so app-code edits don't force repeat visitors to re-download
        // three.js on every deploy.
        manualChunks: (id) => {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/simplex-noise")) return "simplex";
        },
      },
    },
    // esbuild minifier is built-in and fast; no extra install needed.
    minify: "esbuild",
    cssCodeSplit: true,
    sourcemap: false,
    target: "es2022",
  },
};
