# Mobile visual implementation review

This pass applies the supplied 32-screen PDF and video to the implemented native
screens. The reference is a visual contract, not evidence of working custody.
The product specification and parity ledger remain the feature and release records.

## Presentation changes

- Shared Pali navy/pink surfaces, consistent card corners, compact secondary
  actions, accessible segmented filters, readable labels and responsive gutters.
- Activity prioritizes transactions. Refresh lives in the header; coverage and
  zero-value filters live in Activity options. Saved pending remains directly
  reachable. EVM and UTXO use the same filter component.
- Wallet and asset detail are distinct views. Asset detail includes the market
  price, 24-hour change, seven-day chart, range, market cap and source timestamp.
  Market data is display-only, with explicit loading/unavailable states; no chart
  is fabricated for unsupported networks or missing history.
- Market identity comes from shared network metadata or the exact token
  platform/contract. Requests use the existing native HTTP adapter, have bounded
  responses and cancellation, and cache a bounded set of public prices.
- Send and approval screens retain their existing authorization handlers and
  show primary decisions in keyboard-aware footers. Nested views reset scrolling
  without remounting their owning transaction controller.
- Accounts use compact identity rows and grouped Add actions. Trezor accounts are
  explicitly labelled as hardware accounts rather than Smart or seed accounts.
- Setup, unlock, backup, settings, hardware, modules, guardian, private-pool and
  Sentry screens share the same control hierarchy. Development captions are
  restricted to development builds.

## Verification scope

The source review covers the implemented screen families, not only the static
design catalogue. Browser rendering uses the real React Native components and
public synthetic adapters at 320 and 390 pixels. These renders validate layout
and interactions; they do not establish native keyboard, biometric, camera,
Bluetooth, push-delivery or physical-device qualification.

Targeted checks cover market identity/response bounds, account projection,
auto-lock presentation, nested Back behavior, module review, infrastructure
review and pairing navigation. The broader functional and physical-device QA
pass follows the stable PR head. No new cryptographic engine, signing policy,
backend service, SDK vendor patch or package release is part of this visual pass.
