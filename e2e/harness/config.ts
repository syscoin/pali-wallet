import path from 'path';

// Central, env-overridable configuration for the agent e2e harness.
//
// Everything here is testnet-only. The default seed is the shared zkTanenbaum
// faucet seed used for automated QA loops; it must never hold real funds.

const repoRoot = path.resolve(__dirname, '../..');

const runId =
  process.env.PALI_E2E_RUN_ID ||
  new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
// Pin the run id so Playwright worker processes (which re-evaluate this
// module) resolve the same artifacts directory as the runner process.
process.env.PALI_E2E_RUN_ID = runId;

export const E2E_CONFIG = {
  artifactsDir: path.join(repoRoot, 'e2e', 'artifacts', runId),
  chainId: Number(process.env.PALI_E2E_CHAIN_ID || 57057),
  extensionPath: path.join(repoRoot, 'build', 'chrome'),
  headless: process.env.PALI_E2E_HEADED !== 'true',
  networkLabel: process.env.PALI_E2E_NETWORK_LABEL || 'zkTanenbaum',
  password:
    process.env.PALI_E2E_PASSWORD ||
    process.env.TEST_WALLET_PASSWORD ||
    'PaliE2E!2026',
  repoRoot,
  rpcUrl: process.env.PALI_E2E_RPC_URL || 'https://rpc-zk.tanenbaum.io',
  runId,
  seedPhrase:
    process.env.PALI_E2E_SEED ||
    process.env.TEST_WALLET_SEED_PHRASE ||
    'abuse expect crisp unaware skirt adjust height coin seven attitude usual kick',
  // Public testnets confirm slowly; journeys wait on real userOps and deploys.
  slowActionTimeoutMs: Number(
    process.env.PALI_E2E_SLOW_ACTION_TIMEOUT_MS || 240_000
  ),
} as const;

export type E2EConfig = typeof E2E_CONFIG;
