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

Only `en` is published by default. Enable another locale only after the translated technical content has been reviewed for API, security, and passkey accuracy.

## Add a Locale

Generate translation files from `docs/portal`:

```bash
yarn docusaurus write-translations --locale es
```

Then translate docs into:

```text
i18n/es/docusaurus-plugin-content-docs/current/
```

Translate generated theme/navbar/footer strings under:

```text
i18n/es/code.json
```

After review, add the locale code to `i18n.locales` in `docusaurus.config.js` and add a navbar locale dropdown if more than one locale is live.

## Review Notes

Do not machine-translate passkey, sponsor policy, transaction signing, recovery, or provider API pages without technical review. Stale or imprecise translations can create security and integration errors.
