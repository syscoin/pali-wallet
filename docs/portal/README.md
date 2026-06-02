# Pali Wallet Docs Portal

This is the public documentation portal for Pali Wallet.

## Local development

```bash
yarn install
yarn start
```

## Build

```bash
yarn build
```

## Vercel

Configure Vercel as a project rooted at this directory.

| Setting | Value |
| --- | --- |
| Root Directory | `docs/portal` |
| Install Command | `yarn install` |
| Build Command | `yarn build` |
| Output Directory | `build` |
| Node.js | `20.x` |
| Production branch | `master` |
| Domain | `docs.paliwallet.com` |

The docs app is intentionally isolated from the browser extension build. Do not point Vercel at the repository root for this project.
