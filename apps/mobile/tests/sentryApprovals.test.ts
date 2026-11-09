import assert from 'node:assert/strict';
import test from 'node:test';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import {
  buildSentryServiceUpdate,
  buildSentryRegistrarUpdate,
  buildSentryOperatorUpdate,
  governanceVotingKeyIds,
  importSentryAuthorityKey,
  sentryKeyId,
  verifySentryGovernanceVote,
  verifySentryManagementOperation,
  verifySentryOperation,
  type SentryAuthorityKey,
  type SentryGovernanceVoteContext,
  type SentryGovernanceVoteRequest,
} from '@sidhujag/sysweb3-sentry';
import {
  createNativeSentryApprovals,
  createNativeSentryJsonReader,
} from '../src/custody/sentryApprovals.ts';
import { createNativeSentryCollateral } from '../src/custody/sentryNodeManagement.ts';
import { createSentryCryptoExecutor } from '../src/crypto/sentryCryptoExecutor.ts';
import {
  createNativeSentryWalletAuthority,
  type NativeSentryWalletAuthority,
} from '../src/custody/sentryWalletAuthority.ts';
import { executeSentryCryptoJob } from '../../../source/wallet/sentryCryptoExecution.ts';
import { createSentryCollateralCoordinator } from '../../../source/wallet/sentryCollateral.ts';
import {
  createSentryKeyVault,
  type ISentryKeyVaultHost,
} from '../../../source/wallet/sentryKeyVault.ts';
import { SENTRY_NETWORKS } from '../../../source/shared/sentryNetworks.ts';
import {
  emptySentryNodeStore,
  inspectSentryNodeStore,
  type SentryNodeStore,
} from '../src/storage/sentryNodeDomain.ts';
import { resolveUtxoNetwork } from '../src/core/utxoNetworks.ts';
import type {
  RunSentryCrypto,
  SentryCryptoJob,
} from '../../../source/wallet/sentryCryptoJobs.ts';
import { qualifyNativeSentryApprovals } from '../qualification/native-sentry-approvals.ts';

const PASSWORD = 'Public approval fixture password 1!';
const SEED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const scalar = (n: number) => n.toString(16).padStart(64, '0');
const sdkCrypto = () =>
  createSentryCryptoExecutor(async () => executeSentryCryptoJob, null);
const current = () => undefined;
const chain = {
  genesisHash: SENTRY_NETWORKS.mainnet.genesisHash,
  era: 'legacy-v3' as const,
};

async function fixture() {
  let live = true;
  const check = () => {
    if (!live) throw new Error('CANCELLED');
  };
  const lifetime = new AbortController();
  const keys = await Promise.all([
    importSentryAuthorityKey('voting', 'secp256k1', scalar(2)),
    importSentryAuthorityKey('operator', 'bls-basic', scalar(1)),
    importSentryAuthorityKey('owner', 'secp256k1', scalar(3)),
  ]);
  const scope = {
    network: 'mainnet' as const,
    vaultId: 'ab'.repeat(32),
    profileId: '0x' + 'cd'.repeat(32),
    walletBindingId: 'ef'.repeat(32),
    pairFingerprint: '12'.repeat(32),
  };
  const stores = new Map<string, unknown>();
  const vaultHost: ISentryKeyVaultHost = {
    crypto: () => globalThis.crypto,
    async read(key) {
      check();
      return structuredClone(stores.get(key));
    },
    async write(key, expected, value, assertCurrent) {
      check();
      assertCurrent();
      assert.deepEqual(stores.get(key), expected);
      stores.set(key, structuredClone(value));
      check();
      assertCurrent();
    },
  };
  const vault = createSentryKeyVault(vaultHost);
  const summaries = await vault.saveSentryKeys({
    vaultId: scope.vaultId,
    network: scope.network,
    seed: SEED,
    entries: keys.map((key, index) => ({
      key,
      label: `Public fixture ${index}`,
    })),
    assertCurrent: check,
  });
  let nodes: SentryNodeStore | undefined;
  const nodeStorage = {
    async read() {
      check();
      return nodes ? structuredClone(nodes) : undefined;
    },
    async compareAndSet(
      expected: SentryNodeStore | undefined,
      next: SentryNodeStore,
      assertCurrent: () => void
    ) {
      check();
      assertCurrent();
      assert.deepEqual(nodes, expected);
      nodes = inspectSentryNodeStore(next, scope.network, scope);
      check();
      assertCurrent();
    },
  };
  const collateral = createNativeSentryCollateral({
    scope,
    rootPublicIdentity: 'public-fixture-root',
    storage: nodeStorage,
    assertCurrent: check,
    coordinator: createSentryCollateralCoordinator(),
  });
  const funding = new syscoinUtils.bitcoinjs.Transaction();
  funding.addInput(Buffer.alloc(32, 1), 0);
  funding.addOutput(Buffer.from('51', 'hex'), 100000n);
  const node = {
    proTxHash: 'a1'.repeat(32),
    collateralOutpoint: { txid: 'b1'.repeat(32), vout: 1 },
    operatorPublicKey: keys[1]!.publicKey,
    ownerKeyId: sentryKeyId(keys[2]!.publicKey),
    votingKeyId: sentryKeyId(keys[0]!.publicKey),
    service: '127.0.0.1:8369',
    operatorPayoutScript: '51',
    payoutScript: '76a914' + '11'.repeat(20) + '88ac',
    nevmAddress: '',
  };
  const request = buildSentryServiceUpdate({
    chain,
    node,
    service: '127.0.0.2:8369',
    inputs: [{ txid: funding.getId(), vout: 0 }],
    outputs: [{ valueSatoshis: '99000', scriptHex: '51' }],
  });
  const voteRequest: SentryGovernanceVoteRequest = {
    version: 1,
    chain,
    proposalHash: '9a'.repeat(32),
    signal: 'funding',
    outcome: 'yes',
    timestamp: Math.floor(Date.now() / 1000),
    nodes: [
      {
        proTxHash: node.proTxHash,
        collateralOutpoint: node.collateralOutpoint,
      },
    ],
  };
  let voteContext: SentryGovernanceVoteContext = {
    chain,
    proposalHash: voteRequest.proposalHash,
    proposal: { name: 'Verified proposal' },
    now: voteRequest.timestamp,
    nodes: [
      { ...voteRequest.nodes[0]!, votingKeyId: node.votingKeyId, valid: true },
    ],
  };
  let reads = 0,
    authentications = 0,
    signatures = 0,
    posts = 0;
  let service = 'https://trusted.test';
  let readHook: (() => Promise<void>) | undefined;
  let runCrypto: RunSentryCrypto = sdkCrypto();
  const fetcher: typeof fetch = async (url, init) => {
    check();
    reads++;
    if (init?.method !== 'GET') posts++;
    await readHook?.();
    const parsed = new URL(String(url));
    let body: unknown;
    if (parsed.pathname.endsWith('/voting-context')) body = voteContext;
    else if (parsed.pathname.endsWith('/context')) body = { chain, node };
    else if (parsed.pathname.endsWith('/' + funding.getId()))
      body = { hex: funding.toHex() };
    else throw new Error('Unexpected public read');
    const response = Response.json(body);
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  };
  const readJson = createNativeSentryJsonReader({
    assertCurrent: check,
    lifetime: lifetime.signal,
    fetch: fetcher,
  });
  let walletAuthority: NativeSentryWalletAuthority = {
    has: async () => false,
    resolve: async () => undefined,
    owns: async () => false,
  };
  const adapter = () =>
    createNativeSentryApprovals({
      assertCurrent: check,
      lifetime: lifetime.signal,
      network: scope.network,
      scope: {
        identity: 'session-origin-topic-request',
        rootPublicIdentity: 'public-fixture-root',
        network: {
          chainId: 57,
          kind: 'syscoin',
          url: 'https://blockbook.test',
        },
      },
      collateral,
      nodeStorage,
      vaultHost,
      vaultId: scope.vaultId,
      readJson,
      readSettings: async () => ({
        serviceUrl: service,
        maxFeeSatoshis: '10000',
      }),
      async readSeed(password, assertCurrent) {
        check();
        assertCurrent();
        authentications++;
        if (password !== PASSWORD) throw new Error('INVALID_CREDENTIAL');
        return SEED;
      },
      run: async (operation) => {
        check();
        const result = await operation();
        check();
        return result;
      },
      runCrypto: async (job, assertCurrent) => {
        if (
          job.type === 'sign' ||
          job.type === 'signManagement' ||
          job.type === 'signVote'
        )
          signatures++;
        return runCrypto(job, assertCurrent);
      },
      walletAuthority: {
        has: (address) => walletAuthority.has(address),
        resolve: (params, purpose) => walletAuthority.resolve(params, purpose),
        owns: (outpoint) => walletAuthority.owns(outpoint),
      },
    });
  return {
    adapter,
    lifetime,
    check,
    collateral,
    request,
    funding,
    node,
    keys,
    summaries,
    voteRequest,
    stores,
    vault,
    context: () => ({
      chain,
      network: SENTRY_NETWORKS.mainnet.encoding,
      node,
      previousTransactions: [funding.toHex()],
      maxFeeSatoshis: '10000',
    }),
    voteContext: () => voteContext,
    setVoteContext: (next: SentryGovernanceVoteContext) => {
      voteContext = next;
    },
    setService: (next: string) => {
      service = next;
    },
    holdReads: (hook: typeof readHook) => {
      readHook = hook;
    },
    setExecutor: (executor: RunSentryCrypto) => {
      runCrypto = executor;
    },
    setAuthority: (authority: typeof walletAuthority) => {
      walletAuthority = authority;
    },
    retire: () => {
      live = false;
    },
    counts: () => ({ reads, authentications, signatures, posts }),
    saveNodes: (value: SentryNodeStore) => {
      nodes = value;
    },
    emptyNodes: () => emptySentryNodeStore(scope),
  };
}

test('real encrypted voting key signs the reviewed proposal; public facade and results contain no secret', async () => {
  const f = await fixture(),
    manager = f.adapter();
  try {
    const id = await manager.votes.prepare(f.voteRequest, 'https://dapp.test', () => undefined, { assertCurrent: () => undefined, signal: new AbortController().signal });
    const approval = manager.votes.getApproval(id);
    assert.equal(approval.origin, 'https://dapp.test');
    assert.equal(approval.missingVotingKeys.length, 0);
    assert(Object.isFrozen(approval.request.nodes[0]));
    assert.equal('host' in manager.votes, false);
    const result = await manager.votes.sign({ id, password: PASSWORD });
    assert.equal(result.votes.length, 1);
    assert(
      await verifySentryGovernanceVote(
        f.voteRequest,
        f.voteContext(),
        result.votes[0]!
      )
    );
    assert.equal(Buffer.from(result.votes[0]!.voteSig, 'base64').length, 65);
    assert.doesNotMatch(
      JSON.stringify([approval, result, [...f.stores.values()]]),
      new RegExp(f.keys[0]!.secretKey)
    );
    assert.deepEqual(f.counts(), {
      reads: 2,
      authentications: 1,
      signatures: 1,
      posts: 0,
    });
    assert.throws(() => manager.votes.getApproval(id));
  } finally {
    manager.dispose();
  }
});

test('real BLS service authorization and secp management use the same SDK reviews and fee intent', async () => {
  const f = await fixture(),
    manager = f.adapter();
  try {
    const id = await manager.operations.prepare(f.request, 'https://dapp.test', () => undefined, { assertCurrent: () => undefined, signal: new AbortController().signal });
    const approval = manager.operations.getApproval(id);
    assert.equal(approval.keys[0]!.scheme, 'bls-basic');
    const result = await manager.operations.sign({
      id,
      keyId: approval.keys[0]!.id,
      password: PASSWORD,
    });
manager.operations.publishFeeAuthorization(id);
    assert(
      await verifySentryOperation(
        { ...f.request, transactionHex: result.transactionHex },
        f.context()
      )
    );
    const feeId = manager.operations.prepareFeePsbt(
      result.transactionHex,
      'https://dapp.test'
    );
    await manager.operations.reviewFeePsbt(feeId, result.transactionHex, { assertCurrent: () => undefined, signal: new AbortController().signal });
    assert.throws(() =>
      manager.operations.prepareFeePsbt(
        result.transactionHex,
        'https://other.test'
      )
    );
    const request = buildSentryRegistrarUpdate({
      chain,
      node: f.node,
      payoutScript: '76a914' + '22'.repeat(20) + '88ac',
      inputs: [{ txid: f.funding.getId(), vout: 0 }],
      outputs: [{ valueSatoshis: '99000', scriptHex: '51' }],
    });
    const managementId = await manager.operations.prepare(
      request,
      'https://dapp.test', () => undefined, { assertCurrent: () => undefined, signal: new AbortController().signal }
    );
    const key = manager.operations
      .getApproval(managementId)
      .keys.find((item) => item.role === 'owner')!;
    const signed = await manager.operations.sign({
      id: managementId,
      keyId: key.id,
      authorizationId: key.authorizationId,
      password: PASSWORD,
    });
manager.operations.publishFeeAuthorization(managementId);
    assert(
      await verifySentryManagementOperation(
        { ...request, transactionHex: signed.transactionHex },
        f.context()
      )
    );
    assert.equal(f.counts().signatures, 2);
    assert.equal(f.counts().posts, 0);
  } finally {
    manager.dispose();
  }
});

test('fresh proposal, node, service or selected owner changes cannot release an approval signature', async () => {
  for (const change of [
    'proposal',
    'votingKey',
    'service',
    'scope',
    'cancel',
  ] as const) {
    const f = await fixture(),
      manager = f.adapter();
    try {
      const id = await manager.votes.prepare(
        f.voteRequest,
        'https://dapp.test', () => undefined, { assertCurrent: () => undefined, signal: new AbortController().signal }
      );
      if (change === 'proposal')
        f.setVoteContext({
          ...f.voteContext(),
          proposal: { name: 'Changed proposal' },
        });
      if (change === 'votingKey')
        f.setVoteContext({
          ...f.voteContext(),
          nodes: f
            .voteContext()
            .nodes.map((node) => ({ ...node, votingKeyId: '33'.repeat(20) })),
        });
      if (change === 'service') f.setService('https://changed.test');
      if (change === 'scope') f.retire();
      if (change === 'cancel') manager.votes.cancel(id);
      await assert.rejects(async () =>
        manager.votes.sign({ id, password: PASSWORD })
      );
      assert.equal(f.counts().signatures, 0, change);
      assert.equal(f.counts().posts, 0, change);
    } finally {
      manager.dispose();
    }
  }
});

test('cancellation drains a started real SDK signature and withholds its late result', async () => {
  const f = await fixture(),
    manager = f.adapter();
  try {
    const id = await manager.votes.prepare(f.voteRequest, 'https://dapp.test', () => undefined, { assertCurrent: () => undefined, signal: new AbortController().signal });
    const entered = Promise.withResolvers<void>(),
      finish = Promise.withResolvers<void>();
    f.setExecutor(async (job, check) => {
      const result = await executeSentryCryptoJob(job, check);
      if (job.type === 'signVote') {
        entered.resolve();
        await finish.promise;
      }
      return result as never;
    });
    let settled = false;
    const pending = manager.votes.sign({ id, password: PASSWORD });
    const refused = assert.rejects(
      pending.finally(() => {
        settled = true;
      }),
      /CANCELLED/
    );
    await entered.promise;
    f.lifetime.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    finish.resolve();
    await refused;
    assert.equal(f.counts().signatures, 1);
    assert.equal(f.counts().posts, 0);
  } finally {
    manager.dispose();
  }
});

test('governance authorization preserves the existing collateral admission semantics', async () => {
  const f = await fixture(),
    manager = f.adapter();
  try {
    const admission =
      await f.collateral.registry.captureSentryCollateralAdmission(
        f.collateral.scope
      );
    const id = await manager.votes.prepare(f.voteRequest, 'https://dapp.test', () => undefined, { assertCurrent: () => undefined, signal: new AbortController().signal });
    await manager.votes.sign({ id, password: PASSWORD });
    await f.collateral.registry.reserveSentryCollateral({
      ...f.collateral.scope,
      admission,
      reservation: {
        ...f.node.collateralOutpoint,
        proTxHash: f.node.proTxHash,
      },
      assertCurrent: f.check,
    });
    assert.deepEqual(
      await f.collateral.registry.getSentryCollateralReservations(
        f.collateral.scope
      ),
      [{ ...f.node.collateralOutpoint, proTxHash: f.node.proTxHash }]
    );
  } finally {
    manager.dispose();
  }
});

test('selected imported software WIF votes through the shared authority matcher, including uncompressed Core identity', async () => {
  const f = await fixture();
  const network = resolveUtxoNetwork('syscoin');
  const pair = syscoinUtils.bitcoinjs.ECPair.fromPrivateKey(
    Buffer.from(scalar(4), 'hex'),
    { network: network.addressNetwork, compressed: false }
  );
  const address = syscoinUtils.bitcoinjs.payments.p2pkh({
    pubkey: pair.publicKey,
    network: network.addressNetwork,
  }).address!;
  const compressed = syscoinUtils.bitcoinjs.ECPair.fromPrivateKey(
    Buffer.from(scalar(4), 'hex')
  ).publicKey;
  const identities = await governanceVotingKeyIds(
    Buffer.from(compressed).toString('hex')
  );
  f.setVoteContext({
    ...f.voteContext(),
    nodes: f
      .voteContext()
      .nodes.map((node) => ({ ...node, votingKeyId: identities.uncompressed })),
  });
  const authority = createNativeSentryWalletAuthority({
    account: { address, xpub: address },
    accountId: 0,
    assertCurrent: f.check,
    hasPrivateMaterial: true,
    imported: true,
    network,
    readJson: async () => {
      throw new Error('Single WIF does not disclose an account key');
    },
    async readPrivateAccount(password, check) {
      check();
      assert.equal(password, PASSWORD);
      return pair.toWIF();
    },
  });
  f.setAuthority(authority);
  const manager = f.adapter();
  try {
    const id = await manager.votes.prepare(f.voteRequest, 'https://dapp.test', () => undefined, { assertCurrent: () => undefined, signal: new AbortController().signal });
    assert.equal(
      manager.votes.getApproval(id).nodes[0]!.keyId,
      'wallet-voting'
    );
    const result = await manager.votes.sign({ id, password: PASSWORD });
    assert(
      await verifySentryGovernanceVote(
        f.voteRequest,
        f.voteContext(),
        result.votes[0]!
      )
    );
  } finally {
    manager.dispose();
  }
});

test('executor snapshots secrets before loading; missing SHAKE signing never enters the shared dispatcher', async () => {
  const loading = Promise.withResolvers<RunSentryCrypto>();
  const execute = createSentryCryptoExecutor(() => loading.promise, null);
  const job: SentryCryptoJob = {
    type: 'import',
    role: 'voting',
    scheme: 'secp256k1',
    secretKey: scalar(2),
  };
  const pending = execute<SentryAuthorityKey>(job, current);
  job.secretKey = scalar(3);
  loading.resolve(executeSentryCryptoJob);
  assert.equal(
    (await pending).publicKey,
    (await importSentryAuthorityKey('voting', 'secp256k1', scalar(2))).publicKey
  );
  let loads = 0;
  const refuse = createSentryCryptoExecutor(async () => {
    loads++;
    return executeSentryCryptoJob;
  }, null);
  await assert.rejects(
    refuse(
      {
        type: 'import',
        role: 'operator',
        scheme: 'slh-dsa-shake-128s',
        secretKey: '11'.repeat(64),
      },
      current
    ),
    /SENTRY_SHAKE_EXECUTION_UNAVAILABLE/
  );
  await assert.rejects(
    refuse(
      {
        type: 'import',
        role: 'voting',
        scheme: 'secp256k1',
        secretKey: scalar(2),
      },
      (async () => undefined) as () => void
    ),
    /synchronous/
  );
  assert.equal(loads, 0);
});

test('distinct signing qualification executes exact Core-format BLS and governance vectors through the production SDK dispatcher', async () => {
  const execute = sdkCrypto();
  assert.equal(
    await qualifyNativeSentryApprovals(new AbortController().signal, execute),
    execute
  );
  const stale = new AbortController();
  stale.abort();
  await assert.rejects(
    qualifyNativeSentryApprovals(stale.signal, execute),
    /CANCELLED/
  );
});

test('legacy operator preparation cannot route a PQ authorization through the classical executor', async () => {
  const f = await fixture();
  const request = buildSentryOperatorUpdate({
    chain,
    node: f.node,
    mode: 'initial',
    candidate: {
      version: 1,
      profile: 1,
      keyVersion: 1,
      publicKey: '23'.repeat(32),
      activatedHeight: 0,
      childKeyCommitmentHex:
        '01000100eb0010000100000000000000' + '11'.repeat(32) + '22'.repeat(32),
    },
    inputs: [{ txid: f.funding.getId(), vout: 0 }],
    outputs: [{ valueSatoshis: '99000', scriptHex: '51' }],
  });
  const context = { ...f.context(), allowOperatorPreparation: true };
  let signatures = 0;
  const execute = createSentryCryptoExecutor(
    async () => async (job, check) => {
      if (job.type === 'signManagement') signatures++;
      return executeSentryCryptoJob(job, check);
    },
    null
  );
  await assert.rejects(
    execute(
      {
        type: 'signManagement',
        request,
        context,
        authorizationId: 'owner',
        key: f.keys[2]!,
      },
      current
    ),
    /SENTRY_SHAKE_EXECUTION_UNAVAILABLE/
  );
  assert.equal(signatures, 0);
});

test('native JSON reads refuse redirects, overflow, late scope and caller cancellation before accepting public context', async () => {
  for (const failure of ['redirect', 'oversize', 'scope', 'cancel'] as const) {
    const lifetime = new AbortController();
    let live = true;
    const check = () => {
      if (!live) throw new Error('CANCELLED');
    };
    const read = createNativeSentryJsonReader({
      assertCurrent: check,
      lifetime: lifetime.signal,
      fetch: async (url) => {
        if (failure === 'scope') live = false;
        if (failure === 'cancel') lifetime.abort();
        const response = Response.json({ public: 'x'.repeat(100) });
        Object.defineProperty(response, 'url', {
          value: failure === 'redirect' ? 'https://other.test' : String(url),
        });
        return response;
      },
    });
    await assert.rejects(
      read(
        'https://trusted.test/api/context',
        failure === 'oversize' ? 16 : 1000,
        current, lifetime.signal
      )
    );
  }
});


test('fresh child cancellation aborts a held Sentry context read independently of the retained wallet lifetime', async () => {
  const wallet = new AbortController(), child = new AbortController();
  let observed: AbortSignal | undefined;
  const entered = Promise.withResolvers<void>();
  const read = createNativeSentryJsonReader({ assertCurrent: current, lifetime: wallet.signal,
    fetch: async (_url, init) => { observed = init!.signal!; entered.resolve(); return new Promise(() => {}); } });
  const pending = read('https://trusted.test/api/context', 65536, current, child.signal);
  await entered.promise; child.abort(); await assert.rejects(pending);
  assert(observed!.aborted); assert.equal(wallet.signal.aborted, false);
});


test('native published fee authority outlives only its parent wire and refuses an original-grant successor', async () => {
  const f = await fixture(), manager = f.adapter(), parent = new AbortController();
  let grant: object = {}; const captured = grant;
  const assertGrant = () => { if (grant !== captured) throw new Error('GRANT_CHANGED'); };
  try {
    const id = await manager.operations.prepare(f.request, 'https://dapp.test', assertGrant, { assertCurrent: current, signal: parent.signal });
    const response = await manager.operations.sign({ id, keyId: manager.operations.getApproval(id).keys[0]!.id, password: PASSWORD });
    assert.throws(() => manager.operations.prepareFeePsbt(response.transactionHex, 'https://dapp.test'));
    manager.operations.publishFeeAuthorization(id);
    parent.abort(); manager.operations.cancel(id);
    const token = manager.operations.prepareFeePsbt(response.transactionHex, 'https://dapp.test');
    await manager.operations.reviewFeePsbt(token, response.transactionHex, { assertCurrent: current, signal: new AbortController().signal });
    grant = {}; manager.operations.revalidate();
    assert.throws(() => manager.operations.prepareFeePsbt(response.transactionHex, 'https://dapp.test'));
  } finally { manager.dispose(); }
});
