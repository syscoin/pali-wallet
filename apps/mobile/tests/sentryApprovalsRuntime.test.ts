import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  importSentryAuthorityKey,
  sentryKeyId,
  verifySentryGovernanceVote,
  type SentryGovernanceVoteRequest,
} from '@sidhujag/sysweb3-sentry';
import { deriveSentryClassicalPublicKey } from '@sidhujag/sysweb3-sentry/classical-public-key';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import {
  createKeyringRuntimeFactory,
  type KeyringRuntime,
} from '../src/custody/keyringRuntime.ts';
import { createSentryClassicalExecutor } from '../src/crypto/sentryClassicalExecutor.ts';
import { createSentryCryptoExecutor } from '../src/crypto/sentryCryptoExecutor.ts';
import { executeSentryCryptoJob } from '../../../source/wallet/sentryCryptoExecution.ts';
import { SENTRY_NETWORKS } from '../../../source/shared/sentryNetworks.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { metadata } from './publicWatchFixtures.ts';
import { resolveUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Public Sentry runtime password 1!';

test('actual native runtime binds encrypted Sentry approvals to topic lifetime, selected account, chain and lock session', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Ambient transport forbidden');
  });
  const dir = await mkdtemp(join(tmpdir(), 'pali-sentry-runtime-'));
  const connection = nodeConnection(join(dir, 'wallet.sqlite')).connection;
  const key = await importSentryAuthorityKey(
    'voting',
    'secp256k1',
    '02'.padStart(64, '0')
  );
  const request: SentryGovernanceVoteRequest = {
    version: 1,
    chain: {
      genesisHash: SENTRY_NETWORKS.mainnet.genesisHash,
      era: 'legacy-v3',
    },
    proposalHash: '9a'.repeat(32),
    signal: 'funding',
    outcome: 'yes',
    timestamp: Math.floor(Date.now() / 1000),
    nodes: [
      {
        proTxHash: 'a1'.repeat(32),
        collateralOutpoint: { txid: 'b1'.repeat(32), vout: 1 },
      },
    ],
  };
  const context = {
    chain: request.chain,
    proposalHash: request.proposalHash,
    proposal: { name: 'Runtime proposal' },
    now: request.timestamp,
    nodes: [
      {
        ...request.nodes[0]!,
        votingKeyId: sentryKeyId(key.publicKey),
        valid: true as const,
      },
    ],
  };
  let signatures = 0,
    posts = 0;
  const factory = createKeyringRuntimeFactory({
    readEvmRetirement: null,
    ensureCryptoReady: async () => undefined,
    openStorage: () =>
      SqliteWalletStorage.open(connection, digest, INSTALLATION, true),
    deriveSentryPublicKey: createSentryClassicalExecutor(
      deriveSentryClassicalPublicKey
    ),
    runSentryCrypto: createSentryCryptoExecutor(
      async () => async (job, check) => {
        if (job.type === 'signVote') signatures++;
        return executeSentryCryptoJob(job, check);
      },
      null
    ),
    utxoFetch: async (url, init) => {
      if (init?.method !== 'GET') posts++;
      const network = String(url).startsWith(
        resolveUtxoNetwork('utxo:5700').endpoint
      )
        ? resolveUtxoNetwork('utxo:5700')
        : resolveUtxoNetwork('syscoin');
      const path = new URL(String(url)).pathname;
      const body =
        path === '/api/v2/'
          ? metadata(network)
          : path === '/api/v2/block-index/0'
          ? { blockHash: network.genesisHash }
          : path.endsWith('/voting-context')
          ? context
          : { tokens: [] };
      const response = Response.json(body);
      Object.defineProperty(response, 'url', { value: String(url) });
      return response;
    },
  });
  let runtime!: KeyringRuntime;
  const authority = new NativeCustodyAuthority({
    async open() {
      runtime = (await factory.open()) as KeyringRuntime;
      return runtime;
    },
  });
  const lifetime = new AbortController();
  let topicCurrent = true;
  const checkTopic = () => {
    if (!topicCurrent) throw new Error('Topic retired');
  };
  const select = (id: string) =>
    authority.selectNetwork(
      id,
      authority.getSnapshot().revision,
      authority.getCatalogue()!.revision
    );
  try {
    await authority.initialize();
    await authority.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint());
    await authority.refreshAuthenticatedMetadata();
    await select('syscoin');
    const keys = await runtime.openSentryKeyManagement!(
      lifetime.signal,
      checkTopic
    );
    const review = await keys.prepareImport(
      '02'.padStart(64, '0'),
      'voting',
      'secp256k1'
    );
    await keys.confirmImport(review, PASSWORD);
    let manager = await runtime.openSentryApprovals!(
      lifetime.signal,
      checkTopic
    );
    let id = await manager.votes.prepare(request, 'https://connected.test');
    const result = await manager.votes.sign({ id, password: PASSWORD });
    assert(
      await verifySentryGovernanceVote(request, context, result.votes[0]!)
    );
    assert.equal(signatures, 1);
    id = await manager.votes.prepare(request, 'https://connected.test');
    topicCurrent = false;
    await assert.rejects(async () =>
      manager.votes.sign({ id, password: PASSWORD })
    );
    topicCurrent = true;
    manager = await runtime.openSentryApprovals!(lifetime.signal, checkTopic);
    id = await manager.votes.prepare(request, 'https://connected.test');
    await select('utxo:5700');
    await assert.rejects(async () =>
      manager.votes.sign({ id, password: PASSWORD })
    );
    await select('syscoin');
    manager = await runtime.openSentryApprovals!(lifetime.signal, checkTopic);
    id = await manager.votes.prepare(request, 'https://connected.test');
    await authority.manageAccounts(
      { kind: 'create', label: 'Second public fixture', password: PASSWORD },
      authority.getSnapshot().revision,
      authority.getCatalogue()!.revision
    );
    await assert.rejects(async () =>
      manager.votes.sign({ id, password: PASSWORD })
    );
    manager = await runtime.openSentryApprovals!(lifetime.signal, checkTopic);
    id = await manager.votes.prepare(request, 'https://connected.test');
    await authority.lock();
    await assert.rejects(async () =>
      manager.votes.sign({ id, password: PASSWORD })
    );
    assert.equal(signatures, 1);
    assert.equal(posts, 0);
  } finally {
    lifetime.abort();
    await authority.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
