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
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
    // esbuild minifier is built-in and fast; no extra install needed.
    minify: "esbuild",
    cssCodeSplit: true,
    sourcemap: false,
    target: "es2022",
  },
};
