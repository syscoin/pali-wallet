# Historical ETH1 Release scale qualification

The external public specimen is **13,113,982 bytes**, with **97,135 leaves** and **92,918 withdrawn nullifiers**. Its SHA-256 is `c781e937602f0e0e2418ea0b403410bec58e59b3e2beb5ce4a399c0f0bc3676b`. The captured block is 26,352,958 and the expected root is `0x272882aa78148f62d6490051a5b3740408affed64b1ffa41bc703321ddfc8430`. A 262,144-leaf workload would be a separate specimen.

The checker verifies the complete input digest, invokes the shared guarded snapshot parser, and rebuilds the root and the first and last paths using a separate bottom-up traversal with the shared MiMC primitive. It requires an independently retained, normalized public RPC transcript. No snapshot bytes or transcript are bundled with the app or downloaded by this tool.

Use a JSON object with version 1 and a `passes` array containing two arrays of eight entries. Each entry has exactly `jsonrpc`, `id`, `read` and `result`. Use distinct positive safe integer IDs across both passes. Each pass records chain ID, block, next index, last root, levels, denomination, the same block again, and current known-root status. Use the read names exported by the existing public-pool contract. Normalize each public block result to its number, hash and timestamp. Keep the exact canonical quantity and ABI-word results. Supply the sanitized transcript as an explicit file. Its digest binds the detached tree and the final host report. A matching offline replay checks consistency with the supplied record and does not verify provenance from a live provider.

From `apps/mobile`, run the host-only preparation after the two-pass transcript has been independently checked.

```sh
node --import ./scripts/register-shared-test-dependencies.mjs \
  qualification/prepare-eth1-release-scale.cjs /absolute/public-eth1.json /absolute/public-anchor-transcript.json
```

Preparation refuses missing or mismatched inputs before creating a detached scratch checkout with no remote. It pins production commit `e853b032464bd149ac8e0ede22ad2bc33a2220b1`, checks every projected file against its exact input blob, and includes the unchanged production budget module in the source manifest. It commits only the qualification overlay there. Use its reported commit as `GITHUB_SHA`.

The detached build keeps the existing Expo/native registration and the production 16 MiB response and 20 MiB whole-run ceilings. Its ETH1 HTTP snapshot and two HTTPS anchor passes are loopback-only. It retains the existing 64 KiB pulls, 128-leaf batches, 25-second native and 45-second whole-run deadlines. The historical clock advances with monotonic elapsed time. The separate application ID is `com.paliwallet.qualification.eth1scale`.

For an eventual Release run, follow the existing public-pool smoke’s manual install, loopback mapping, launch and report steps in this isolated checkout with disposable simulator/emulator targets and CA trust. Use the scale application ID for install, launch and container access. The ordinary hosted workflow and its fixed-package orchestrator are separate. Append the same snapshot and transcript paths to the **host** `run-public-pool-fixture.cjs` command. The app still receives only the loopback launch parameters. The runner requires a matching source revision and transcript digest before opening its local listeners. Compare its two anchor passes and 759 native batches, root and path digests, and lease retirement with the app's bounded report.

On November 6, 2026 the wallet’s existing owned anchor verifier captured two complete read-only passes against dRPC’s public Ethereum endpoint. The capture has SHA-256 `369c27b6f0cc8837bae00a9aa7516b5ed999ae9d13ff61a4b2d8d5a26de588d6`. The detached iOS Simulator 27.2 Release build at `6bc13377b77839d747bb168737fb3f0b22b48282` replayed that capture, read the exact public snapshot over loopback, and passed all 759 native batches and both proof checks. The local readiness-to-verdict interval was 18.8 seconds. The verified evidence file has SHA-256 `65453b7b3961ff5f38bb9ca28afa5caa809b3816e7271ab64a49c8b90472f820`.

Use the mobile dependency loader for the host fixture when the checkout has only the mobile lockfile installed. The isolated app ID is also the only allowed public SLH fixture ID inside the detached Swift and Kotlin projection. Android full-scale, physical-device, production service, memory, cancellation and cap-rejection qualification remain separate.

Run the isolated host contract tests explicitly.

```sh
node --import ./scripts/register-shared-test-dependencies.mjs --test qualification/eth1-scale/fixture.test.cjs
```
