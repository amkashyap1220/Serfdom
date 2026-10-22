import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    port: 5173,
    // Fail loudly if the port is taken instead of silently picking another,
    // so test instructions always point at the right URL.
    strictPort: true,
  },
  build: {
    // Phaser alone is ~1.5 MB minified, above Vite's 500 kB default warning.
    // Code-splitting is premature for a prototype; revisit before release.
    chunkSizeWarningLimit: 2000,
  },
  test: {
    // Unit tests cover pure logic only and run in Node, not a browser.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
