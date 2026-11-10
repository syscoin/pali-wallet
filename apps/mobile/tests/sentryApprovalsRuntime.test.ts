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

const softwarePsbtHandoff = { id: 'software-fixture', expiresAt: Number.MAX_SAFE_INTEGER, beforeSuiteOpen() { throw Error('Unexpected hardware handoff'); }, beforeSignature() { throw Error('Unexpected hardware signature'); }, isSuspended: () => false };
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
  const factory = createKeyringRuntimeFactory({ privacyServiceSettings: null, slhExecution: null,
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
    , () => {});
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
    let id = await manager.votes.prepare(request, 'https://connected.test', checkTopic, { assertCurrent: checkTopic, signal: lifetime.signal });
    const result = await manager.votes.sign({ id, password: PASSWORD });
    assert(
      await verifySentryGovernanceVote(request, context, result.votes[0]!)
    );
    assert.equal(signatures, 1);
    id = await manager.votes.prepare(request, 'https://connected.test', checkTopic, { assertCurrent: checkTopic, signal: lifetime.signal });
    topicCurrent = false;
    await assert.rejects(async () =>
      manager.votes.sign({ id, password: PASSWORD })
    );
    topicCurrent = true;
    manager = await runtime.openSentryApprovals!(lifetime.signal, checkTopic);
    id = await manager.votes.prepare(request, 'https://connected.test', checkTopic, { assertCurrent: checkTopic, signal: lifetime.signal });
    await select('utxo:5700');
    await assert.rejects(async () =>
      manager.votes.sign({ id, password: PASSWORD })
    );
    await select('syscoin');
    manager = await runtime.openSentryApprovals!(lifetime.signal, checkTopic);
    id = await manager.votes.prepare(request, 'https://connected.test', checkTopic, { assertCurrent: checkTopic, signal: lifetime.signal });
    await authority.manageAccounts(
      { kind: 'create', label: 'Second public fixture', password: PASSWORD },
      authority.getSnapshot().revision,
      authority.getCatalogue()!.revision
    );
    await assert.rejects(async () =>
      manager.votes.sign({ id, password: PASSWORD })
    );
    manager = await runtime.openSentryApprovals!(lifetime.signal, checkTopic);
    id = await manager.votes.prepare(request, 'https://connected.test', checkTopic, { assertCurrent: checkTopic, signal: lifetime.signal });
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

test('actual runtime carries a disclosed Sentry operation into one child fee PSBT and preserves cancel/lock ownership', async t => {
  const [{ utils }, { PsbtUtils }, sentry] = await Promise.all([
    import('syscoinjs-lib'), import('@sidhujag/sysweb3-keyring/cjs/utils/psbt.js'), import('@sidhujag/sysweb3-sentry'),
  ]);
  const bitcoin = utils.bitcoinjs, network = resolveUtxoNetwork('syscoin');
  const directory = await mkdtemp(join(tmpdir(), 'pali-sentry-fee-runtime-'));
  const connection = nodeConnection(join(directory, 'wallet.sqlite')).connection;
  const operator = await importSentryAuthorityKey('operator', 'bls-basic', '01'.padStart(64, '0'));
  const chain = { genesisHash: network.genesisHash, era: 'legacy-v3' as const };
  const collateral = new bitcoin.Transaction(); collateral.addInput(Buffer.alloc(32, 19), 0); collateral.addOutput(Buffer.from('51', 'hex'), BigInt(100000));
  const node = { proTxHash: 'a1'.repeat(32), operatorPublicKey: operator.publicKey, service: '127.0.0.1:8369',
    operatorPayoutScript: '51', nevmAddress: '', collateralOutpoint: { txid: collateral.getId(), vout: 0 } };
  let funding: InstanceType<typeof bitcoin.Transaction>, address = '', xpub = '', posts = 0, roleSignatures = 0;
  let held: { entered: ReturnType<typeof Promise.withResolvers<void>>; release: ReturnType<typeof Promise.withResolvers<void>>; signal?: AbortSignal } | undefined;
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Ambient transport forbidden'); });
  const factory = createKeyringRuntimeFactory({ privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null, ensureCryptoReady: async () => undefined,
    openStorage: () => SqliteWalletStorage.open(connection, digest, INSTALLATION, true),
    deriveSentryPublicKey: createSentryClassicalExecutor(deriveSentryClassicalPublicKey),
    runSentryCrypto: createSentryCryptoExecutor(async () => async (job, check) => {
      if (job.type === 'sign') roleSignatures++;
      return executeSentryCryptoJob(job, check);
    }, null),
    utxoFetch: async (input, init) => {
      if (init?.method !== 'GET') { posts++; throw new Error('Fee signing must not submit'); }
      const url = String(input), path = new URL(url).pathname;
      let body: unknown;
      if (path === '/api/v2/') body = metadata(network);
      else if (path === '/api/v2/block-index/0') body = { blockHash: network.genesisHash };
      else if (path.endsWith('/context')) {
        if (held) { const pending = held; pending.signal = init.signal!; pending.entered.resolve(); await pending.release.promise; }
        body = { chain, node };
      } else if (path === `/api/v2/tx/${funding?.getId()}`) body = { hex: funding.toHex() };
      else if (path === `/api/v2/tx/${collateral.getId()}`) body = { hex: collateral.toHex() };
      else if (path === `/api/v2/xpub/${xpub}`) body = { tokens: [{ name: address, path: "m/84'/57'/0'/0/0" }] };
      else throw new Error(`Unexpected public route ${path}`);
      const response = Response.json(body); Object.defineProperty(response, 'url', { value: url }); return response;
    },
  });
  let runtime!: KeyringRuntime;
  const authority = new NativeCustodyAuthority({ async open() { runtime = await factory.open() as KeyringRuntime; return runtime; } });
  const owner = new AbortController(), grant = {};
  let currentGrant: object | undefined = grant;
  const checkGrant = () => { if (currentGrant !== grant) throw new Error('Grant retired'); };
  try {
    await authority.initialize(); await authority.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint()); await authority.refreshAuthenticatedMetadata();
    await authority.selectNetwork('syscoin', authority.getSnapshot().revision, authority.getCatalogue()!.revision, () => undefined);
    const context = (await runtime.openConnectionHost()).context();
    const account = context.accounts.find(value => value.id === context.activeAccountId)!;
    address = account.address; xpub = account.xpub!;
    const script = bitcoin.address.toOutputScript(address, network.addressNetwork);
    funding = new bitcoin.Transaction(); funding.addInput(Buffer.alloc(32, 17), 0); funding.addOutput(script, BigInt(100000));
    const keys = await runtime.openSentryKeyManagement!(owner.signal, checkGrant);
    const imported = await keys.prepareImport('01'.padStart(64, '0'), 'operator', 'bls-basic'); await keys.confirmImport(imported, PASSWORD);
    const manager = await runtime.openConnectionSentryApprovals();
    const request = sentry.buildSentryServiceUpdate({ chain, node, service: '127.0.0.2:8369',
      inputs: [{ txid: funding.getId(), vout: 0 }], outputs: [{ valueSatoshis: '99000', scriptHex: Buffer.from(script).toString('hex') }] });
    const origin = 'https://original.sentry.test';
    const authorize = async () => {
      const parent = new AbortController();
      const id = await manager.operations.prepare(request, origin, checkGrant, { assertCurrent: checkGrant, signal: parent.signal });
      const result = await manager.operations.sign({ id, keyId: manager.operations.getApproval(id).keys[0]!.id, password: PASSWORD });
      manager.operations.publishFeeAuthorization(id); parent.abort(); manager.operations.cancel(id);
      const raw = bitcoin.Transaction.fromHex(result.transactionHex), psbt = new bitcoin.Psbt({ network: network.addressNetwork });
      psbt.setVersion(raw.version); psbt.setLocktime(raw.locktime);
      raw.ins.forEach((input: { hash: Uint8Array; index: number; sequence: number }) => psbt.addInput({ hash: input.hash, index: input.index, sequence: input.sequence,
        witnessUtxo: { script, value: BigInt(100000) }, unknownKeyVals: [
          { key: Buffer.from('path'), value: Buffer.from("m/84'/57'/0'/0/0") }, { key: Buffer.from('address'), value: Buffer.from(address) },
        ] }));
      raw.outs.forEach((output: { script: Uint8Array; value: bigint }) => psbt.addOutput({ script: output.script, value: output.value }));
      assert.equal(Buffer.from(psbt.data.globalMap.unsignedTx.toBuffer()).toString('hex'), result.transactionHex);
      return { result, child: { method: 'sys_sign' as const, origin, psbt: PsbtUtils.toPali(psbt) } };
    };
    const first = await authorize();
    const prepared = await runtime.prepareConnectionPsbt(first.child, new AbortController().signal, checkGrant, softwarePsbtHandoff);
    assert.equal(prepared.review.sentry?.operation, 'updateService'); assert.equal(prepared.review.feeSatoshis, '1000');
    const signed = await prepared.approve(); assert('psbt' in signed);
    const transaction = PsbtUtils.fromPali(signed, { currency: 'sys', slip44: 57 }).extractTransaction();
    assert(transaction.ins[0].witness.length > 0);
    assert(await sentry.verifySentryOperation({ ...request, transactionHex: transaction.toHex() }, { chain, node, previousTransactions: [funding.toHex()], maxFeeSatoshis: '10000' }));
    assert.throws(() => manager.operations.prepareFeePsbt(first.result.transactionHex, origin)); prepared.dispose();
    const second = await authorize(), child = new AbortController();
    held = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
    const cancelled = runtime.prepareConnectionPsbt(second.child, child.signal, checkGrant, softwarePsbtHandoff);
    const cancellation = assert.rejects(cancelled); await held.entered.promise; child.abort(); await cancellation;
    assert(held.signal!.aborted); held.release.resolve(); held = undefined;
    const next = await runtime.prepareConnectionPsbt(second.child, new AbortController().signal, checkGrant, softwarePsbtHandoff);
    held = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
    const approval = next.approve(), rejected = assert.rejects(approval); await held.entered.promise;
    const locking = authority.lock(); await rejected; assert(held.signal!.aborted); held.release.resolve(); held = undefined; await locking;
    await assert.rejects(next.approve()); next.dispose();
    assert.throws(() => manager.operations.prepareFeePsbt(second.result.transactionHex, origin));
    assert.equal(roleSignatures, 2); assert.equal(posts, 0);
  } finally { currentGrant = undefined; owner.abort(); held?.release.resolve(); await authority.dispose(); await rm(directory, { recursive: true, force: true }); }
});
