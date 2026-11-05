# Shared signed transaction records

`transferJournal.ts` contains only native screen DTOs and error names. Both hosts use `source/wallet/evmSignedRecords.ts` for canonical signed-record persistence and retention, and the SDK's captured submission boundary waits for acknowledged persistence before broadcast.

Ownership is the authenticated seed profile, chain and canonical sender address. HD/imported aliases share those records; account type and index are immutable attribution. Every retained transaction keeps its original signed bytes, including predecessors, replacements, reverted transactions and nonce-used observations. Public history pruning and account removal never delete them. Status is a revisable RPC observation. Retries require explicit review and send the exact saved bytes.

One version-1 encrypted bundle is bounded to 4,096 transactions and 16 MiB per profile, with no automatic eviction. SDK private-record encryption protects chunked raw bytes and an authenticated manifest. Chrome supplies acknowledged storage under the wallet persistence mutex; native supplies its protected SQLite compare-and-set domain. Ambiguous writes quarantine the owner until a fresh storage instance verifies the retained data. Unsupported or malformed records remain preserved and unavailable.

The existing shared protocol gas validator governs new admission. Reading historical signed records does not retroactively apply a changed gas policy. A new submission or retry still passes current SDK and transport checks.
