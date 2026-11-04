# Pali mobile: full-wallet design

The target is feature equivalence with the existing extension. The current native development flow implements wallet creation/import, password unlock, seed backup, multiple seed-derived Ethereum accounts (create/select/rename/remove/restore), and per-account ETH portfolio, receive and send operations with an encrypted transaction journal. Watch-only accounts and the design explorer remain separate modes. The explorer specifies the broader product without activating capabilities. Full feature equivalence remains incomplete. An end-to-end native testnet transfer, physical-device behavior and signed release artifacts remain unqualified.

## Review the design

Run `npm run build:web` and serve the preview as described in [the mobile README](../README.md). From the welcome screen choose **Review full wallet design**. The explorer supports screen search, connected flow navigation, account-kind comparisons and loading/offline/locked/changed/expired/unavailable scenarios. All secret fields, addresses and QR codes are inert samples.

The primary navigation is **Wallet / Activity / Tools / Settings**. Wallet has distinct account and network controls. Tools contains Connected apps, Private assets, Smart accounts and Sentry; relevant shortcuts also appear in Wallet. Sensitive reviews, backup and authorization temporarily occupy a dedicated screen.

## Design records

| Record                                                    | Purpose                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Product design](PRODUCT_DESIGN.md)                       | Information architecture, screen hierarchy, components, accessibility and interactions     |
| [Extension parity matrix](PARITY_MATRIX.md)               | 46 source-backed capability groups; none are silently dropped                              |
| [Security-sensitive flows](SECURITY_FLOWS.md)             | Identity, custody, recovery, approval and interruption behavior                            |
| [Whole-note-vault backup proposal](NOTE_BUNDLE_BACKUP.md) | Explicit shared extension/mobile enhancement, separate from current individual-note reveal |
| [Executable screen catalogue](../src/design/catalog.ts)   | Exact design IDs, navigation, sample content and feature traceability                      |
| [Validation record](../VALIDATION.md#full-wallet-design-review) | Historical design coverage and browser checks; current scope and qualification boundaries               |

The screen catalogue maps every parity group to one or more proposed surfaces. A screen being present is **design coverage**, not an implemented or validated native feature. Provider reads/subscriptions also need protocol tests; screen count does not measure API parity.

## Settled design choices

- Keep Pali's existing branding and readable native system typography. Use one deliberate primary action, generous touch targets, safe-area footers and one content scroll owner per screen.
- Preserve HD/imported/watch-only/hardware/smart account distinctions. Watching an account never creates signing authority.
- Preserve asset and network identity across every step. EVM, Bitcoin, Syscoin UTXO, NFT and sign-only PSBT sample journeys have their own matching review/outcome.
- Guardian recovery in the inspected extension uses **one guardian, threshold 1**. Composite signing thresholds are a separate feature. The initial mobile draft conflated these; this is a design correction, not a newly established extension vulnerability.
- Privacy parity means the source's **Ethereum Mainnet pinned pools**, individual raw-note import and password-gated reveal. It does not imply private SYS pools or an existing portable encrypted backup format.
- Add **Back up all private notes / Restore note backup** as a separately identified shared enhancement. The same versioned encrypted package must work in both clients. Default restore merges, deduplicates and verifies current note state; it does not overwrite newer local state or trust a stale saved balance.
- Keep the supported validator module scope explicit. Do not imply arbitrary executor/hook installation, editable service infrastructure or broader recovery policies that the source has not established.

## Implementation sequence after design review

1. Qualify the implemented shared wallet authority and native storage/lifecycle ports for create, import, backup and lock on real devices; implement and qualify remaining recovery flows.
2. Qualify the Ethereum HD-account flow, including an end-to-end native testnet transfer, then implement and qualify remaining EVM and Syscoin/Bitcoin UTXO reads/transfers, token/NFT flows, transaction status and replacements.
3. Implement mobile connection transport and the complete source approval/protocol matrix.
4. Implement smart account/authenticator, guardian, privacy/proof and Sentry capabilities with per-chain/device gates.
5. Add qualified hardware transports and the portable whole-note-vault backup format; keep both clients interoperable and covered by the same test vectors.

Ordering is an engineering sequence, not permission to declare reduced feature parity. Each capability needs an implemented service, source-equivalent outcomes, interruption tests and the appropriate physical-device evidence before release.
