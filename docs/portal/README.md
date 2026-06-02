# Pali Wallet Docs Portal

This is the public documentation portal for Pali Wallet.

## Local development

```bash
yarn install
yarn start
```

`yarn start` is Docusaurus dev mode for a single locale. It does not serve the production `build/` directory, and the local search index is not available there.

To develop a specific locale:

```bash
yarn start:locale es
```

## Build

```bash
yarn build
```

`yarn build` emits all configured locale routes. Use `yarn build:en` for a faster English-only local check.

To test the production build locally, including locale switching and search:

```bash
yarn preview
```

or:

```bash
yarn build
yarn serve
```

Do not use `yarn start` to test the built multilingual site. In dev mode, clicking the language selector can append locale prefixes to the current path instead of behaving like the production build.

## Internationalization

The portal is configured for the same locale set as Pali Wallet: English, Spanish, Portuguese, French, German, Russian, Chinese, Japanese, and Korean.

The language selector is live. Navbar, footer, sidebar category labels, homepage chrome, and technical markdown pages are translated under `i18n/<locale>/docusaurus-plugin-content-docs/current/`.

Local search indexes the multilingual docs content for supported Lunr languages. Korean docs are published, but Korean-specific search tokenization is excluded because the current `lunr-languages` Korean trimmer breaks the combined search regex; Latin technical identifiers on Korean pages remain searchable.

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
