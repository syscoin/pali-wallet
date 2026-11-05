# Shared Blockbook watch sessions

The production Add Watch flow accepts an EVM address, or a supported Bitcoin/Syscoin public address, account key or descriptor. It uses the extension's public-input validator and the existing SDK public descriptor/address helpers. No private keyring session is created.

The normal watch session opens the canonical record repository, validates each public address projection and retains account identifiers internally. Refresh checks the stored source identity before requesting its balance. Account and network changes, privacy lock, cancellation and superseding refreshes invalidate pending results.

Both address and account balance reads call the existing `syscoinjs-lib` `utils.fetchBackendAccount`. The library owns the encoded `/api/v2/address/` or `/api/v2/xpub/` query. Mobile supplies its existing bounded native HTTP session through the library's optional fetch port. Blockbook owns account discovery and receive/change aggregation. Mobile has no gap scanner, checkpoint, continuation action or per-address summation.

The native boundary checks the configured network and genesis, bounds responses, enforces cancellation and rejects malformed amounts, wrong identifiers or partial/unavailable replies. Confirmed units and pending delta remain separate exact decimal strings. Refresh never writes a checkpoint. A watch session cannot sign or send.

This is account balance support. It does not establish watch-only activity, notification, hardware or physical-device qualification. Those features remain separate parity work.
