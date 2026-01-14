import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';

export default defineConfig({
  plugins: [
    devtools(),
    solidPlugin(),
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
  build: {
    target: 'esnext',
  },
});
