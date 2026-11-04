# Confirmed activity for one watched UTXO address

This development feature is independent of the public account-key preparation code. It accepts the current key-free public authority selection and uses the same fixed `walletFetch` port as other public UTXO reads. No SDK, public-key parser, vault, signing capability, history persistence, provider selection or address derivation is added.

The user must open Activity and press **Load confirmed activity**. Construction and mounting perform no activity I/O. The notice identifies the full watched address, fixed network/provider and its address/IP disclosure. Consent and loaded rows belong to that foreground mounted screen and exact authority generation. Account/network changes (including A-B-A), lock/unlock, background/inactive, Android focus loss, tab departure and unmount cancel/revoke the view. Returning requires another explicit action.

Each request opens the existing sampled UTXO read session: metadata readiness and coin/network/decimals/chain, genesis, then sampled tip. A page uses `GET /api/v2/address/<address>?details=txids&pageSize=20&page=N&to=H`, with the initial sampled height H retained across explicit older pages. Nonzero `to` excludes pending transactions. Each returned transaction is loaded from `/api/v2/tx/<id>`, projected from its input/output native amounts and checked against its block-height/hash lookup. The sampled anchor is checked again before publication; later pages also check the original anchor before disclosure and before publication. These are checks for consistency with one provider, not SPV, finality, ChainLock or independent provider authentication.

Bounds are 20 IDs per page, five pages/100 rows, two concurrent requests, 128 inputs and 128 outputs per transaction, 32 KiB per response, 1 MiB consumed per page and 30 seconds. JSON work is bounded before projection. No full-detail page, provider fallback, spending lookup, polling, websocket, enrichment or background work is used. Read/parse/identity/anchor failures publish no partial page. A failed first load is unavailable, not empty; a failed subsequent read keeps same-context old rows visibly stale until explicit refresh. Another context immediately clears old rows. Oversized or unusual valid transactions can therefore make a page unavailable.

Amounts use exact integers. `received` sums native outputs to this address; `spent` sums native inputs from it; net is received minus spent. “Whole transaction fee” is computed and checked from all native inputs/outputs and may involve other inputs. A debit of 10 with a fee of 1 does not imply an additional debit of 1. Missing input values never become zero. Coinbase input/fee handling is explicit. Unsupported native mint accounting fails closed. Asset metadata is only marked as additional unsupported activity; asset quantities, names, symbols, memos, URLs and aliases are not rendered. No counterparty is inferred to be owned, and no counterparty copy action exists.

Details expose the validated transaction ID, watched address, exact native breakdown, captured confirmations and block information. Only the transaction ID is copied. The explorer URL is locally constructed from the fixed provider and validated hash, opened only after a foreground/current-context user action. Details preserve the mounted list and its scroll position. Refresh is manual and starts a new sampled range. The end of a loaded page is never called a complete wallet history.

Back, detail selection and refresh retire action feedback synchronously. A previously dispatched copy or browser action still drains; only its own operation may release the mounted view's action gate. Completion cannot confirm another selected transaction, leave actions stuck after row replacement, or release a newer owner's pending action. This does not cancel or undo an external action already dispatched.

## API evidence and qualification

The contract was traced statically against local Blockbook source `4cea9ff4cb071dbf7475a4d43344830ba0348f68`:

- `api/types.go:64,86-92,177-211,389-435,496-511`: Amount is a decimal-string big integer; input/output amounts, transaction fields and paging/address responses.
- `server/public.go:1198-1237,1267-1276,1773-1797,1832-1856`: details and height-query parsing, V2 transaction and address routes.
- `api/worker.go:1226-1231,1868-1912,2430-2585`: height-bounded newest-first pages; `itemsOnPage` is capacity; page clamping; unknown `totalPages=-1`; nonzero `to` excludes mempool.
- `api/worker.go:634-685,700-738,1797-1855`: missing input values, native totals, fee clamping and `bestHeight - height + 1` confirmation convention.
- `openapi.yaml:1178-1239`: pending entries lead ordinary paging and churn shifts offsets; a fixed `to` is the documented consistent confirmed-history route.
- `docs/api-syscoin.md:7-37`: SPT values are distinct from outer native values.

A deployed service may run another revision or differ in behavior. Unit tests use the real session helper with synthetic responses; the browser fixture runs the actual App/WatchSession/WatchActivity while intercepting HTTP and external actions. Neither establishes deployed-provider correctness, native transport, physical-device lifecycle/clipboard behavior or a release. Pending/replaced/dropped activity, other addresses in the wallet, SPT history and complete account history remain outside this slice.
