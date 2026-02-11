# Frontend Deployment (Vercel)

The frontend is deployed as a pre-built static site via `vercel --prebuilt`. Remote builds on Vercel are not supported due to Aztec SDK native/WASM dependencies and bun version incompatibilities.

## Prerequisites

- [Vercel CLI](https://vercel.com/docs/cli) installed and logged in
- Foundry contracts built (`make build-l1`)
- Frontend built locally

## Deploy

```bash
# 1. Build frontend (requires eth/out/ artifacts from forge build)
cd frontend && bun run build && cd ..

# 2. Copy build output to Vercel's prebuilt directory
rm -rf .vercel/output/static/*
cp -r frontend/dist/* .vercel/output/static/
cp frontend/dist/.deployments.* .vercel/output/static/

# 3. Deploy to production
vercel deploy --prebuilt --prod --yes
```

## Configuration

- `vercel.json` — build settings and response headers
- `.vercel/output/config.json` — routing rules and COOP/COEP headers
- `.vercelignore` — controls which files are uploaded (excludes e2e, eth/out, etc.)

### Required Headers

The Aztec SDK uses WASM with SharedArrayBuffer, which requires cross-origin isolation:

| Header | Value | Purpose |
|--------|-------|---------|
| Cross-Origin-Opener-Policy | `same-origin` | Isolate browsing context |
| Cross-Origin-Embedder-Policy | `credentialless` | Allow SharedArrayBuffer while permitting external resource loads |

> `credentialless` is used instead of `require-corp` so Web3Modal can load external wallet icons/scripts.

## Updating Contract ABIs

`frontend/public/artifacts/` contains fallback ABI files for builds without Foundry. After recompiling contracts, refresh them:

```bash
cp eth/out/MockERC20.sol/MockERC20.json frontend/public/artifacts/
cp eth/out/MockLendingPool.sol/MockLendingPool.json frontend/public/artifacts/
cp eth/out/AztecAavePortalL1.sol/AztecAavePortalL1.json frontend/public/artifacts/
```

## Updating Deployment Addresses

Deployment address files (`.deployments.devnet.json`) are fetched at runtime from the static site root. They are copied into the build from the repo root by `vite-static-copy` if present, or can be placed directly in `frontend/public/`.
