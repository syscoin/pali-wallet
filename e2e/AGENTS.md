# Pali e2e agent harness

Playwright harness that drives the real Pali extension against the live
zkTanenbaum testnet with a dedicated test seed. It is built for agent loops:
every run produces machine-readable summaries, screenshots, videos, and
Playwright traces so an agent (or human) can iterate on UX, find quirks/bugs,
and verify features end to end without manual setup.

Everything here is **testnet-only**. The default seed holds fake funds and must
never be used with real money.

## Quick start

```bash
# 1. Build the extension (use Node >= 23.3; v23.2.0 has a webpack-breaking bug)
yarn build:chrome

# 2. Run all journeys (headless)
yarn e2e:harness

# 3. Or run one journey, headed for debugging
yarn e2e:harness:headed journeys/onboarding
```

Playwright Chromium must be installed once: `npx playwright install chromium`.

## Layout

```
e2e/
  playwright.config.ts   # dedicated config: 1 worker, 15 min/journey, traces
  harness/
    config.ts            # env-overridable E2E_CONFIG (seed, RPC, paths, runId)
    launch.ts            # launches Chromium with the built extension loaded
    pali.ts              # PaliWallet driver (onboard, unlock, networks, accounts)
    chain.ts             # direct RPC assertions (ethers, with 5xx retries)
    summary.ts           # JourneySummary -> <runId>/<journey>.summary.json
  journeys/
    onboarding.journey.spec.ts     # import seed, switch network, read balance
    smart-account.journey.spec.ts  # infra deploy, create + select smart account
  artifacts/<runId>/     # all outputs for a run (gitignored)
```

## Configuration (env vars)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PALI_E2E_SEED` | shared zkTanenbaum QA seed | wallet seed phrase (testnet only) |
| `PALI_E2E_PASSWORD` | `PaliE2E!2026` | wallet password used for onboarding |
| `PALI_E2E_RPC_URL` | `https://rpc-zk.tanenbaum.io` | RPC for direct chain assertions |
| `PALI_E2E_CHAIN_ID` | `57057` | expected chain id |
| `PALI_E2E_NETWORK_LABEL` | `zkTanenbaum` | network name as shown in the UI |
| `PALI_E2E_HEADED` | unset (headless) | `true` opens a visible browser |
| `PALI_E2E_SLOW_ACTION_TIMEOUT_MS` | `240000` | budget for on-chain waits |
| `PALI_E2E_RUN_ID` | timestamp | pin a run id (set automatically) |

## Artifacts (what an agent should read)

Each run writes to `e2e/artifacts/<runId>/`:

- `<journey>.summary.json` — the primary machine-readable output:
  - `steps[]`: name, status, duration, screenshot path, failure note
  - `findings[]`: severity `info` | `quirk` | `bug` with free-form detail
  - `chainEvidence`: addresses and tx hashes proving what happened on-chain
- `screenshots/NNN-step-name.png` — one per step (and per failure)
- `test-output/.../video.webm` + `trace.zip` — full Playwright recording;
  inspect with `npx playwright show-trace <trace.zip>`
- `playwright.json` / `html-report/` — standard Playwright reports

Agent loop recipe: run a journey → parse the summary JSON → triage `failed`
steps and `quirk`/`bug` findings → fix code or extend the journey → rerun.
Record new oddities with `wallet.finding({ severity, detail })` so they
accumulate in the summary instead of being lost in logs.

## Writing journeys

Use the `PaliWallet` driver and wrap every logical action in `wallet.step()` so
it is timed, screenshotted, and recorded:

```ts
const wallet = await PaliWallet.launch('my-journey');
try {
  await wallet.step('onboard', async () => {
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork(E2E_CONFIG.networkLabel);
  });
  // ... more steps + chain assertions via harness/chain.ts
  await wallet.dispose('passed');
} catch (error) {
  await wallet.dispose('failed');
  throw error;
}
```

Conventions:

- Always verify UI claims on-chain via `harness/chain.ts` (`getCode`,
  `getInfrastructureState`, `getNativeBalance`).
- One worker only (configured): journeys share the test seed and must not race
  nonces. Keep journeys independent — each launches a fresh profile.
- Prefer stable ids (`#home-balance`, `#general-settings-button`,
  `#account-SmartAccount-N`, `#import-wallet-input`) over text where possible.

## Known UI quirks the harness already handles

- **First-run modal stack**: home shows a "Connect hardware wallet" bottom
  sheet that intercepts all pointer events; dismissing it opens a
  "Congratulations" headlessui Dialog which marks the rest of the page
  `aria-hidden`, silently breaking every `getByRole` locator. The dialog's
  close control is an `<img>`, not a button, so it is closed with Escape.
  `dismissBlockingModals()` (called from `ensureOnHome`) clears the stack.
- **Public RPC flakiness**: `rpc-zk.tanenbaum.io` returns sporadic 5xx; all
  reads in `harness/chain.ts` retry with backoff.
- **Action timeouts**: the config caps locator waits at 30s so a missing
  element fails fast instead of consuming the whole journey timeout. Pass
  explicit timeouts for legitimately slow on-chain waits.

## CI

Two workflows:

### `e2e-harness.yml` — scheduled / manual journey runs

Runs the journeys on demand (`workflow_dispatch`, with optional journey
filter) and nightly, uploading `e2e/artifacts/` as a build artifact. Secrets
`PALI_E2E_SEED` / `PALI_E2E_PASSWORD` override the defaults.

### `agent-invoke.yml` — GitHub-invoked QA agent

Authorized users (OWNER/MEMBER/COLLABORATOR) invoke the agent by opening an
issue or commenting on an issue/PR with:

```
/pali-agent <request>
```

Examples:

- `/pali-agent run the smart-account journey and triage any failures`
- `/pali-agent add a journey that sends 0.01 TSYS to a second account and
  verify the activity list shows it`
- `/pali-agent the network switcher feels broken on first run, investigate`
- `/pali-agent model=auto run the onboarding journey` (per-invocation model)

Model selection precedence: `model=<id>` as the first token of the command →
`PALI_AGENT_MODEL` repository variable → `composer-2.5` default. Model ids
are validated as plain slugs; valid values depend on the Cursor account
behind `CURSOR_API_KEY` (`auto` lets the server pick).

What happens:

1. The workflow acknowledges with a comment linking the run, builds the
   extension, and starts a Cursor agent (`e2e/scripts/agent-dispatch.mjs`,
   Cursor SDK local runtime) with the request.
2. The agent reads this file, can write/modify journeys, runs them against
   zkTanenbaum, triages `summary.json` results, and writes
   `e2e/artifacts/agent-report.md`.
3. `e2e/scripts/post-results.mjs` pushes screenshots/videos/summaries to the
   orphan `e2e-media` branch and posts a comment on the issue/PR with the
   report, per-step tables, findings, **inline screenshots** and video links —
   visual proof of UX behavior.
4. If the agent changed code, the workflow opens a PR
   (`agent/e2e-<run-id>`) whose description carries the same proof, and links
   it from the issue. PR comments check out the PR branch first, so fixes and
   proof apply to the code under review.

Required secret: `CURSOR_API_KEY` (Cursor user or team service-account key).
Optional: `PALI_E2E_SEED`, `PALI_E2E_PASSWORD`.
