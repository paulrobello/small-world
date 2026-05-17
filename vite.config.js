// Vite config — three.js and simplex-noise are loaded via CDN importmap
module.exports = {
  build: {
    rollupOptions: {
      external: ["three", /^three\//, "simplex-noise"],
    },
  },
};
