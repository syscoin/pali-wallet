# Shared wallet foundation: private-vault engine

The first shared-wallet extraction separates private-note custody logic from its extension host. It does not make `MainController` portable, add a native wallet, or add portable note-backup files.

## Entry points

- `source/wallet/privateVault.ts` is the shared engine. It has no runtime imports of Chrome storage, the Redux store, the extension controller or the global wallet mutex. Importing it does not load the keyring implementation or a hardware transport; its keyring references are types only.
- `source/scripts/Background/controllers/privateVault.ts` remains the extension entry point. It supplies the existing Chrome storage, wallet persistence mutex, note implementation, clocks and random UUID generator. Existing imports and optional dependency overrides remain supported.

This is one implementation with two composition boundaries, not two copies of the vault algorithm. The extension continues to load the engine lazily through its existing controller factory.

## Host contract

The shared factory requires `IPrivateVaultHost` and `IPrivateVaultDependencies`. None of the environment dependencies is inferred from browser globals:

| Dependency               | Host responsibility                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                | Read untrusted encrypted records and acknowledge completed writes. Errors and ambiguous acknowledgements must remain observable. Preserve the engine's record keys and complete-record semantics.                         |
| `mutex`                  | Serialize every operation that shares this vault's persistence boundary, including wallet replacement/removal. Supplying separate mutexes for two users of the same records does not provide isolation.                   |
| `identify` / `generate`  | Use the supported note parser and cryptographically secure note generator. The engine continues validating generated identities.                                                                                          |
| `randomId`               | Supply secure UUIDs for internal records. This is separate from generation of the secret bearer note.                                                                                                                     |
| `now`                    | Supply milliseconds for persisted record timestamps.                                                                                                                                                                      |
| `deadlineNow`            | Supply advancing milliseconds for cleanup deadlines. The extension keeps its historical wall-clock behavior independently of a test override for record timestamps.                                                       |
| `captureSession`         | Return the active encryption profile and an authority generation check. Invalidate captured sessions on lock, wallet replacement or other authority changes; returning to a prior profile must not revive an old session. |
| `authenticate`           | Perform the host's existing password/authorization checks before invoking a secret-reveal callback, and revalidate the captured session across asynchronous work.                                                         |
| `readNote`               | Provide verified public note status without sending a raw note or a note-specific secret query to a service.                                                                                                              |
| `prepareCompletionProof` | Where supported, verify completion evidence and provide the existing final revalidation callback. This remains a trusted-host capability.                                                                                 |

The runtime also needs standards-compatible UTF-8 encoding/decoding and the engine's existing arithmetic dependencies. A native host must qualify these and its encrypted-record implementation on supported devices before handling real secrets.

## Compatibility and authority boundaries

The encryption domains, profile binding, storage keys, note capacities, status rules and write ordering are unchanged. Pre-release note layouts have been consolidated into one explicitly identified first-release format; this is an intentional compatibility break for development data, not a migration. A different host does not gain the ability to decrypt a profile's records merely by reading its storage.

### Canonical note format

Every persisted inventory, including an empty one, has an outer `{ format: "pali-private-note-vault", version: 1, root, shards }` record. The authenticated root repeats the format and version and contains `capacity`, `noteCount` and the ordered shard references. Each reference binds the shard's record UUID, envelope hash and note count. Shard plaintext remains `{ version: 1, notes }`. The outer record, root and shards are committed as one complete storage write.

The default capacity is 128; users may explicitly choose 256 or 512. There is no up-front storage reservation. Shard plaintext remains bounded at 32 KiB, root plaintext at 64 KiB, and the complete serialized bundle at 4/8/16 MiB according to capacity. Reducing capacity below the retained note count fails without a write.

Only a missing record (`null` or `undefined`) means an empty, not-yet-persisted vault. Bare pre-release version 1/2/3 records, unknown discriminators and unknown versions are rejected without mutation. The UI explains that unsupported development data must be opened in its matching development build and backed up. No automatic conversion, reset, deletion or overwrite is performed. Malformed canonical ciphertext remains a corruption/unavailability error; its contents never enter a public error.

Raw-note and deposit/withdrawal capabilities remain inside the trusted wallet authority. Do not expose the engine, its host object or its full return value through an arbitrary UI/controller bridge. Continue projecting only the existing allowlisted public methods and DTOs. Extracting a module does not authorize extra message methods or alter password requirements.

The core rejects missing environment ports instead of falling back to browser storage or ambient randomness. The extension adapter retains the previous defaults so the extraction does not alter its behavior.

## Validation

Run the existing private-vault, privacy transaction/withdrawal and controller integration suites, plus `source/wallet/privateVault.host.spec.ts`. The additional checks cover browser-dependency isolation, adapter defaults, required ports, cross-entry persistence, session invalidation and independent cleanup deadlines. Run the repository type check, lint and production Chrome build as well.

## Following work

Native keyring storage, application lifecycle, wallet creation/recovery, controller/public-state projection and connection transport still need narrow host adapters. `MainController`, Redux, Chrome alarms and the extension message transport remain extension-specific.

Portable whole-note backup is a separate feature and format review. This extraction neither exports internal ciphertext as a backup nor changes the current single-note import/reveal behavior.
