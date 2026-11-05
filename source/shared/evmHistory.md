# Shared EVM history policy

`evmHistory.ts` contains the existing extension's explorer transaction/token
normalization, receipt-status mapping, account ownership/direction and
representative selection. The extension controller and native Activity reader,
controller and screen all call this module. `utils/evmNonce.ts` retains its public
exports while using the same source identifiers and integer parser.

`evmExplorer.ts` owns account URLs and the existing Routescan transport policy:
API keys move from query parameters to headers, and calls share a paced queue
within a host. Extension token discovery/history and native Activity instantiate
this transport with their own fetch adapter.

Platform responsibilities remain explicit. The extension owns its account store,
pending-transaction polling, RPC fallback and smart-account history. Native
Activity owns its bounded response reader, account/session cancellation, page
cursor, RPC receipt verification and encrypted local history. Native explorer
rows discover hashes; they cannot replace RPC-verified transaction facts. Local
attempts remain visible after fetched replacement selection. This extraction
does not enable native NFTs, smart accounts or external pending discovery.

No signing, backup format, chain-specific confirmation policy or custody API is
introduced here.
