# Native transfer journal containers

Each live HD account has one encrypted SQLCipher row at its existing key:
`native-evm-transfer-v1` for index 0, or `native-evm-transfer-v1:hd:60:<index>`.
Value version 2 contains a monotonic revision, wallet fingerprint, exact public HD
account identity and a bounded list of entries. Each entry holds the complete
registered network identity, phase, signed bytes, hash, nonce and creation time.
The internal transfer DTO remains separate from the durable container.

An Ethereum ERC20 entry additionally carries a strict `intent` containing the
reviewed token contract and metadata, recipient and exact base-unit amount. It
uses this same version-2 container and same account/chain slot, not a separate
token nonce domain. The signed envelope must have zero native value and exactly
the canonical `transfer(address,uint256)` calldata for that intent. An entry
without intent still requires empty calldata. Version-1 migration remains
native-only; existing native version-2 records need no rewrite. Older binaries
that do not understand intent must reject and preserve these records, not strip
the field or treat the transaction as a native transfer.

A version 1 Ethereum row is strictly validated and migrated in place by CAS. Its
signed bytes, phase and nonce survive unchanged, including when first opened
from another network context. Missing rows use atomic create-if-absent. Unknown,
malformed or foreign account/registration data is preserved and rejected.
The container admits at most 12 entries and 64 KiB of encoded JSON; signed bytes
remain bounded to 4096 characters. Current registered chains fit within one row
per account, avoiding account-times-network exhaustion of the 64-row store.
No terminal history eviction is added in this phase.

Every existing-row mutation uses exact-snapshot compare-and-set, never `set`.
Independent stale readers retry a definite false up to three times and preserve
other-chain entries. They never resign or replace an unresolved same-chain nonce.
The shared process queue covers read, mutation and readback. Chain ID plus account
address identifies a nonce domain; the full registration additionally pins the
trusted endpoint. A registration mismatch cannot create a second nonce domain.

Rejected, nonboolean or ambiguous write acknowledgements quarantine the storage
capability until close and fresh reopen. A known successful commit followed only
by context revocation preserves the row and discards the stale result without
quarantining the wallet. Readback failures or contradictions require reopen.
The runtime retires SDK secrets synchronously before announcing quarantine and
still drains active work and closes storage. Authenticated hydration validates
every live account’s complete retained container before publishing ready.

The host saves signed bytes and awaits `attempted` before broadcasting. A restart
keeps signed/attempted/submitted entries unresolved and uses their exact hash.
Ethereum confirmed/reverted terminal states require the saved receipt block
hash to match the canonical block at that height, finalized height to cover the
receipt, and the saved nonce to be consumed there. A repeated matching receipt
and final block identity complete the observation. Inconsistent or orphan
receipts leave the exact journal entry unresolved. These remain provider
observations rather than independent consensus proofs. A missing receipt with
consumed finalized nonce produces only nonce-consumed and does not claim that the
original transaction succeeded. Retry requires fresh consent
and reuses the exact saved bytes. The journal itself never sends network traffic.
Retry also compares the complete saved intent with the approved review; token
precision is not encoded in the signed transaction. Recovery never resolves new
metadata from the token list to reinterpret an existing transfer. Successful
finalized execution is described as a confirmed transaction, not proof that an
arbitrary token contract delivered the requested units without fees.

Removal validates every entry and refuses any unresolved, malformed or unknown
outcome. The exact fully-terminal row (or required absence) participates in the
catalogue removal transaction. A new or changed pending chain before commit
prevents deletion. Restoring an HD index restores the address, not pruned terminal
history. Cross-process exclusion remains unqualified; supported ownership is one
wallet authority process with one storage capability.

Phase A changes persistence and recovery only. Runtime signing and submission
remain Ethereum-only. Non-Ethereum fee, receipt and native-signing qualification
must complete before any new send capability is enabled.
