import fs from 'fs';
import { defineConfig, Plugin, searchForWorkspaceRoot } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { PolyfillOptions, nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

// Use workspace root's node_modules (matches Aztec's official vite config approach)
const nodeModulesPath = `${searchForWorkspaceRoot(process.cwd())}/node_modules`;

// Serve .deployments.local.json from project root during development
const serveDeploymentsPlugin = (): Plugin => {
  const deploymentsPath = path.resolve(__dirname, '../.deployments.local.json');
  return {
    name: 'serve-deployments',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/.deployments.local.json') {
          if (fs.existsSync(deploymentsPath)) {
            res.setHeader('Content-Type', 'application/json');
            res.end(fs.readFileSync(deploymentsPath, 'utf-8'));
          } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Deployments file not found. Run deploy script first.' }));
          }
          return;
        }
        next();
      });
    },
  };
};

// Fix for vite-plugin-node-polyfills in workspace setup
// Based on https://github.com/AztecProtocol/aztec-packages/blob/master/boxes/boxes/vite/vite.config.ts
const nodePolyfillsFix = (options?: PolyfillOptions | undefined): Plugin => {
  return {
    ...nodePolyfills(options),
    name: 'node-polyfills-fix',
    enforce: 'pre' as const,
    /* @ts-ignore */
    resolveId(source: string) {
      // Handle node polyfill shims
      const m =
        /^vite-plugin-node-polyfills\/shims\/(buffer|global|process)$/.exec(
          source,
        );
      if (m) {
        return `${nodeModulesPath}/vite-plugin-node-polyfills/shims/${m[1]}/dist/index.js`;
      }
      // Handle util/types - redirect to our shim
      if (source === 'util/types') {
        return path.resolve(__dirname, './src/shims/util-types.ts');
      }
      // Handle hash.js - redirect to our shim
      if (source === 'hash.js') {
        return path.resolve(__dirname, './src/shims/hash.js.ts');
      }
      // Handle sha3 - redirect to our shim
      if (source === 'sha3') {
        return path.resolve(__dirname, './src/shims/sha3.ts');
      }
      // Handle pino - redirect to our shim
      if (source === 'pino') {
        return path.resolve(__dirname, './src/shims/pino.ts');
      }
      // Handle module - redirect to our shim (for createRequire)
      if (source === 'module') {
        return path.resolve(__dirname, './src/shims/module.ts');
      }
      // Handle lmdb - redirect to our shim (native Node.js module)
      if (source === 'lmdb') {
        return path.resolve(__dirname, './src/shims/lmdb.ts');
      }
      // Handle async_hooks - redirect to our shim (Node.js module)
      if (source === 'async_hooks') {
        return path.resolve(__dirname, './src/shims/async_hooks.ts');
      }
      // Handle fs/promises - redirect to our shim (Node.js module)
      if (source === 'fs/promises') {
        return path.resolve(__dirname, './src/shims/fs-promises.ts');
      }
      // Handle node:util - redirect to our shim (Node.js module)
      if (source === 'node:util') {
        return path.resolve(__dirname, './src/shims/node-util.ts');
      }
      // Handle os - redirect to our shim (Node.js module)
      if (source === 'os') {
        return path.resolve(__dirname, './src/shims/os.ts');
      }
    },
  };
};

export default defineConfig({
  plugins: [
    devtools(),
    solidPlugin(),
    wasm(),
    topLevelAwait(),
    serveDeploymentsPlugin(),
    nodePolyfillsFix({
      // Polyfills for Node.js built-ins (matches Aztec official vite config)
      include: ['buffer', 'path', 'process', 'net', 'tty'],
    }),
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
        {
          src: '../.deployments.local.json',
          dest: '.',
        },
      ],
    }),
  ],
  resolve: {
    // Module resolution conditions for browser environment
    conditions: ['development', 'browser'],
    alias: {
      '~': path.resolve(__dirname, './src'),
      // Map @generated imports to the aztec/generated directory where aztec codegen outputs
      '@generated': path.resolve(__dirname, '../aztec/generated'),
      // Provide pino browser shim with proper ESM exports
      'pino': path.resolve(__dirname, './src/shims/pino.ts'),
      // Provide util/types shim for Node.js compatibility
      'util/types': path.resolve(__dirname, './src/shims/util-types.ts'),
      // Provide hash.js shim with ESM default export
      'hash.js': path.resolve(__dirname, './src/shims/hash.js.ts'),
      // Provide sha3 shim with ESM named exports
      'sha3': path.resolve(__dirname, './src/shims/sha3.ts'),
      // Provide module shim for createRequire
      'module': path.resolve(__dirname, './src/shims/module.ts'),
      // Provide lmdb shim (native Node.js module not available in browser)
      'lmdb': path.resolve(__dirname, './src/shims/lmdb.ts'),
      // Provide async_hooks shim (Node.js module not available in browser)
      'async_hooks': path.resolve(__dirname, './src/shims/async_hooks.ts'),
      // Provide fs/promises shim (Node.js module not available in browser)
      'fs/promises': path.resolve(__dirname, './src/shims/fs-promises.ts'),
      // Provide node:util shim (Node.js module not available in browser)
      'node:util': path.resolve(__dirname, './src/shims/node-util.ts'),
      // Provide os shim (Node.js module not available in browser)
      'os': path.resolve(__dirname, './src/shims/os.ts'),
    },
  },
  server: {
    port: 3000,
    // Headers needed for bb WASM to work in multithreaded mode
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: {
      // Allow serving files from the monorepo
      allow: [
        path.resolve(__dirname, '..'),
        path.resolve(__dirname, '../node_modules'),
      ],
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
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
