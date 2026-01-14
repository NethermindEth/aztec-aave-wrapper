import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

export default defineConfig({
  plugins: [
    devtools(),
    solidPlugin(),
    wasm(),
    topLevelAwait(),
    viteStaticCopy({
      targets: [
        {
          src: '../eth/out/MockERC20.sol/MockERC20.json',
          dest: 'artifacts',
        },
        {
          src: '../eth/out/MockLendingPool.sol/MockLendingPool.json',
          dest: 'artifacts',
        },
        {
          src: '../eth/out/AztecAavePortalL1Simple.sol/AztecAavePortalL1Simple.json',
          dest: 'artifacts',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
  },
  optimizeDeps: {
    exclude: ['@aztec/accounts', '@aztec/aztec.js', '@aztec/foundation', '@aztec/stdlib'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      // Aztec SDK uses dynamic imports and WASM that need special handling
      // These packages are loaded dynamically at runtime, not bundled
      external: (id) => {
        // Externalize all Aztec packages
        if (id.startsWith('@aztec/')) return true;
        // Externalize generated Aztec contract code (depends on Aztec SDK)
        // Match paths like 'aztec/generated/' or 'src/generated/AaveWrapper'
        if (/\/(aztec|src)\/generated\//.test(id)) return true;
        return false;
      },
      output: {
        // Manual chunks for better code splitting
        manualChunks: {
          vendor: ['solid-js', 'viem'],
        },
      },
    },
    // Increase chunk size warning limit for SDK-heavy apps
    chunkSizeWarningLimit: 1000,
  },
});
