# Translation Workflow

The docs portal is prepared to use the same locale set as Pali Wallet:

- `en` - English
- `es` - Spanish
- `pt` - Portuguese
- `fr` - French
- `de` - German
- `ru` - Russian
- `zh` - Chinese
- `ja` - Japanese
- `ko` - Korean

All locale routes are published so the language selector is available. Navbar, footer, sidebar category labels, homepage chrome, and technical markdown pages are translated for the configured locales.

Local search indexes the multilingual docs content for supported Lunr languages. Korean docs are published, but Korean-specific search tokenization is excluded because the current `lunr-languages` Korean trimmer breaks the combined search regex; Latin technical identifiers on Korean pages remain searchable.

## Update Translation Catalogs

Regenerate translation files from `docs/portal` after adding new strings:

```bash
yarn docusaurus write-translations --locale es
```

Repeat for each non-English locale.

## Translate Technical Docs

Translate docs into:

```text
i18n/es/docusaurus-plugin-content-docs/current/
```

Translate generated theme/navbar/footer strings under:

```text
i18n/es/code.json
```

The locale code must remain in `i18n.locales` in `docusaurus.config.js` for the translated route to be built.

## Review Notes

Do not machine-translate passkey, smart-account module policy, transaction signing, recovery, or provider API pages without technical review. Stale or imprecise translations can create security and integration errors.
