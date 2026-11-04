# Pali mobile: full-wallet design

The target is feature equivalence with the existing extension. The [current capability ledger](PARITY_MATRIX.md#current-implementation-ledger) records the exact development source, implemented account/read/transfer flows and outstanding native qualification. Watch-only accounts and the design explorer remain separate from custody. The explorer specifies the broader product without activating capabilities; full feature equivalence remains incomplete.

## Review the design

Run `npm run build:web` and serve the preview as described in [the mobile README](../README.md). From the welcome screen choose **Review full wallet design**. The explorer supports screen search, connected flow navigation, account-kind comparisons and loading/offline/locked/changed/expired/unavailable scenarios. All secret fields, addresses and QR codes are inert samples.

The target primary navigation is **Wallet / Activity / Tools / Settings**. Wallet has distinct account and network controls. Tools contains Connected apps, Private assets, Smart accounts and Sentry; relevant shortcuts also appear in Wallet. Sensitive reviews, backup and authorization temporarily occupy a dedicated screen. This full shell is still a design target, not the implemented native navigation.

## Design records

| Record                                                    | Purpose                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Product design](PRODUCT_DESIGN.md)                       | Information architecture, screen hierarchy, components, accessibility and interactions     |
| [Extension parity matrix](PARITY_MATRIX.md)               | 46 source-backed capability groups; none are silently dropped                              |
| [Security-sensitive flows](SECURITY_FLOWS.md)             | Identity, custody, recovery, approval and interruption behavior                            |
| [Whole-note-vault backup requirements](NOTE_BUNDLE_BACKUP.md) | Original requirements; shared/extension implementation exists, mobile integration remains |
| [Executable screen catalogue](../src/design/catalog.ts)   | Exact design IDs, navigation, sample content and feature traceability                      |
| [Validation record](../VALIDATION.md#full-wallet-design-review) | Historical design coverage and browser checks; current scope and qualification boundaries               |

The screen catalogue maps every parity group to one or more proposed surfaces. A screen being present is **design coverage**, not an implemented or validated native feature. Provider reads/subscriptions also need protocol tests; screen count does not measure API parity.

## Settled design choices

- Keep Pali's existing branding and readable native system typography. Use one deliberate primary action, generous touch targets, safe-area footers and one content scroll owner per screen.
- Preserve HD/imported/watch-only/hardware/smart account distinctions. Watching an account never creates signing authority.
- Preserve asset and network identity across every step. EVM, Bitcoin, Syscoin UTXO, NFT and sign-only PSBT sample journeys have their own matching review/outcome.
- Guardian recovery in the inspected extension uses **one guardian, threshold 1**. Composite signing thresholds are a separate feature. The initial mobile draft conflated these; this is a design correction, not a newly established extension vulnerability.
- Privacy parity means the source's **Ethereum Mainnet pinned pools**, individual raw-note import and password-gated reveal. It does not imply private SYS pools. Mobile privacy operations are not implemented.
- **Back up all private notes / Restore note backup** is an implemented shared/extension enhancement awaiting mobile integration. Both clients must use the same encrypted package. Restore merges and deduplicates without overwriting newer local state or trusting a stale saved balance.
- Keep the supported validator module scope explicit. Do not imply arbitrary executor/hook installation, editable service infrastructure or broader recovery policies that the source has not established.

## Implementation sequence after design review

Use the [ordered remaining slices](PARITY_MATRIX.md#ordered-remaining-implementation-slices) as the implementation sequence. Keep native qualification of existing flows running in parallel, and reuse the shared note-backup implementation instead of designing a second format.

Ordering is an engineering sequence, not permission to declare reduced feature parity. Each capability needs an implemented service, source-equivalent outcomes, interruption tests and the appropriate physical-device evidence before release.
