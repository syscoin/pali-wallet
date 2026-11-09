import { webcrypto } from 'crypto';

import { SENTRY_NETWORKS } from '../shared/sentryNetworks';

import type { SentryOperationHost } from './sentryApprovalHost';
import type { SentryApprovalScope } from './sentryApprovalTypes';
import type { RunSentryCrypto } from './sentryCryptoJobs';
import { SharedSentryOperationApprovals } from './sentryOperationApprovals';
import { SharedSentryVoteApprovals } from './sentryVoteApprovals';

jest.mock('syscoinjs-lib', () => ({
  utils: {
    bitcoinjs: {
      Transaction: {
        fromHex: () => ({
          ins: [{ hash: Buffer.from('44'.repeat(32), 'hex'), index: 0 }],
        }),
      },
      address: { toBase58Check: () => 'registered-authority' },
    },
  },
}));
jest.mock(
  '@sidhujag/sysweb3-sentry',
  () => ({
    validateSentryOperationRequest: (value: unknown) => structuredClone(value),
    validateSentryManagementRequest: (value: unknown) => structuredClone(value),
    inspectSentryOperation: () => ({ proTxHash: 'ab'.repeat(32) }),
    inspectSentryManagementOperation: () => ({ proTxHash: 'ab'.repeat(32) }),
    sentryKeyId: () => '11'.repeat(20),
  }),
  { virtual: true }
);

const node = {
  proTxHash: 'ab'.repeat(32),
  operatorPublicKey: 'bb'.repeat(48),
  votingKeyId: '11'.repeat(20),
  collateralOutpoint: { txid: 'cd'.repeat(32), vout: 1 },
};
const chain = {
  genesisHash: SENTRY_NETWORKS.mainnet.genesisHash,
  era: 'legacy-v3' as const,
};
const operationRequest = {
  version: 1,
  operation: 'updateService',
  chain,
  transactionHex: '0100',
};
const voteRequest = {
  version: 1,
  chain,
  proposalHash: 'ef'.repeat(32),
  signal: 'funding',
  outcome: 'yes',
  timestamp: 1000,
  nodes: [
    { proTxHash: node.proTxHash, collateralOutpoint: node.collateralOutpoint },
  ],
};
const operatorKey = {
  role: 'operator' as const,
  scheme: 'bls-basic' as const,
  publicKey: node.operatorPublicKey,
  secretKey: 'private-operator-key',
};
const votingKey = {
  role: 'voting' as const,
  scheme: 'secp256k1' as const,
  publicKey: '02' + '11'.repeat(32),
  secretKey: 'private-voting-key',
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture() {
  let scope: SentryApprovalScope = {
    identity: 'session',
    rootPublicIdentity: 'root',
    network: { chainId: 57, kind: 'syscoin', url: 'https://blockbook.example' },
  };
  let serviceUrl = 'https://trusted.example';
  let requestCurrent = true;
  const check = (owner: typeof scope) => {
    if (owner.identity !== scope.identity)
      throw new Error('Wallet context changed');
  };
  const runCrypto = jest.fn(async (job, guard) => {
    guard();
    if (job.type === 'validateVote') return structuredClone(job.request);
    if (job.type === 'reviewVote') return { request: job.request };
    if (job.type === 'votingIdentities')
      return [
        {
          publicKey: votingKey.publicKey,
          compressed: node.votingKeyId,
          uncompressed: '22'.repeat(20),
        },
      ];
    if (job.type === 'signVote')
      return { proTxHash: node.proTxHash, voteSig: 'verified-vote' };
    if (job.type === 'sign')
      return { version: 1, operation: 'updateService', transactionHex: '0102' };
    return {
      operation: 'updateService',
      scheme: 'bls-basic',
      proTxHash: node.proTxHash,
      changes: { nevmAddress: { previous: '', next: '' } },
      feeSatoshis: '1000',
    };
  });
  const loadKey = jest.fn(async ({ id, assertCurrent }) => {
    assertCurrent();
    return id === 'voting' ? votingKey : operatorKey;
  });
  const getSeed = jest.fn(async (password, owner, guard) => {
    expect(password).toBe('password');
    check(owner);
    guard();
    return 'private-seed';
  });
  let tail = Promise.resolve();
  const host: SentryOperationHost = {
    captureScope: () => scope,
    captureApprovalScope: () => ({
      ...scope,
      assertRequestCurrent() {
        if (!requestCurrent) throw new Error('Site approval retired');
      },
    }),
    assertCurrent: check,
    getSettings: async () => ({
      network: 'mainnet',
      serviceUrl,
      maxFeeSatoshis: '1000',
      collateral: [],
      linkedNodes: [],
      keys: [
        {
          id: 'operator',
          label: 'Operator',
          network: 'mainnet',
          role: operatorKey.role,
          scheme: operatorKey.scheme,
          publicKey: operatorKey.publicKey,
        },
        {
          id: 'voting',
          label: 'Voting',
          network: 'mainnet',
          role: votingKey.role,
          scheme: votingKey.scheme,
          publicKey: votingKey.publicKey,
        },
      ],
    }),
    readJson: async (url, limit, owner, guard) => {
      check(owner);
      guard();
      if (url.includes('/api/v2/tx/')) {
        expect(limit).toBe(2 * 1024 * 1024);
        return { hex: '0100' };
      }
      expect(limit).toBe(65536);
      return structuredClone({
        chain,
        node,
        nodes: [node],
        proposalHash: voteRequest.proposalHash,
        proposal: { name: 'Verified proposal' },
      });
    },
    getSeed,
    loadKey,
    hasWalletAuthority: async () => false,
    resolveWalletAuthority: async () => undefined,
    runCrypto: runCrypto as RunSentryCrypto,
    runExclusive<T>(operation: () => Promise<T>) {
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    network: () => 'mainnet',
    captureCollateralAdmission: async () => ({
      key: 'collateral',
      generation: 0,
    }),
    ownsCollateral: async () => false,
    reserveCollateral: async () => {
      throw new Error('Unexpected collateral mutation');
    },
  };
  return {
    host,
    runCrypto,
    loadKey,
    getSeed,
    operations: new SharedSentryOperationApprovals(host),
    votes: new SharedSentryVoteApprovals(host),
    revokeRequest: () => {
      requestCurrent = false;
    },
    changeScope: () => {
      scope = { ...scope, identity: 'locked' };
    },
    changeService: () => {
      serviceUrl = 'https://changed.example';
    },
  };
}
beforeEach(() => {
  Object.defineProperty(global, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
});

it.each(['operation', 'vote'] as const)(
  'refuses a retained %s approval after the original site grant retires',
  async (kind) => {
    const f = fixture();
    const controller = kind === 'operation' ? f.operations : f.votes;
    const id = await controller.prepare(
      kind === 'operation' ? operationRequest : voteRequest,
      'https://dapp.example'
    );
    f.revokeRequest();
    await expect(
      kind === 'operation'
        ? f.operations.sign({ id, keyId: 'operator', password: 'password' })
        : f.votes.sign({ id, password: 'password' })
    ).rejects.toThrow('Site approval retired');
    expect(f.getSeed).not.toHaveBeenCalled();
  }
);

it('retires completed operation fee consent with its original site grant', async () => {
  const f = fixture();
  const id = await f.operations.prepare(
    operationRequest,
    'https://dapp.example'
  );
  await f.operations.sign({ id, keyId: 'operator', password: 'password' });
  const token = f.operations.prepareFeePsbt('0102', 'https://dapp.example');
  f.revokeRequest();
  expect(() =>
    f.operations.prepareFeePsbt('0102', 'https://dapp.example')
  ).toThrow();
  expect(() => f.operations.beginFeeSigning(token, '0102')).toThrow();
  await expect(f.operations.reviewFeePsbt(token, '0102')).rejects.toThrow();
});

it.each(['operation', 'vote'] as const)(
  'withholds the %s worker result if the original site retires during signing',
  async (kind) => {
    const f = fixture();
    const controller = kind === 'operation' ? f.operations : f.votes;
    const id = await controller.prepare(
      kind === 'operation' ? operationRequest : voteRequest,
      'https://dapp.example'
    );
    const worker = deferred();
    const started = deferred();
    const execute = f.runCrypto.getMockImplementation()!;
    f.runCrypto.mockImplementation(async (job, check) => {
      if (job.type === 'sign' || job.type === 'signVote') {
        started.resolve();
        await worker.promise;
      }
      return execute(job, check);
    });
    const signing =
      kind === 'operation'
        ? f.operations.sign({ id, keyId: 'operator', password: 'password' })
        : f.votes.sign({ id, password: 'password' });
    await started.promise;
    f.revokeRequest();
    worker.resolve();
    await expect(signing).rejects.toThrow('Site approval retired');
    expect(() =>
      f.operations.prepareFeePsbt('0102', 'https://dapp.example')
    ).toThrow();
  }
);

it('shares public operation review and remembers only the exact completed transaction/origin for fee signing', async () => {
  const f = fixture();
  const id = await f.operations.prepare(
    operationRequest,
    'https://dapp.example'
  );
  expect(f.operations.getApproval(id).keys.map((key) => key.id)).toEqual([
    'operator',
  ]);
  expect(f.getSeed).not.toHaveBeenCalled();
  const response = await f.operations.sign({
    id,
    keyId: 'operator',
    password: 'password',
  });
  expect(JSON.stringify(response)).not.toMatch(/private-/);
  const fee = f.operations.prepareFeePsbt(
    response.transactionHex,
    'https://dapp.example'
  );
  await expect(
    f.operations.reviewFeePsbt(fee, response.transactionHex)
  ).resolves.toMatchObject({ feeSatoshis: '1000' });
  expect(() =>
    f.operations.prepareFeePsbt(
      response.transactionHex,
      'https://other.example'
    )
  ).toThrow('AUTHORIZATION_REQUIRED');
  const finish = f.operations.beginFeeSigning(fee, response.transactionHex);
  finish(true);
  await expect(
    f.operations.reviewFeePsbt(fee, response.transactionHex)
  ).rejects.toThrow('AUTHORIZATION_REQUIRED');
});

it.each(['operations', 'votes'] as const)(
  'refuses changed trusted service before %s secret loading or disclosure',
  async (kind) => {
    const f = fixture();
    const controller = f[kind];
    const id = await controller.prepare(
      kind === 'votes' ? voteRequest : operationRequest,
      'https://dapp.example'
    );
    f.changeService();
    await expect(
      kind === 'votes'
        ? f.votes.sign({ id, password: 'password' })
        : f.operations.sign({ id, keyId: 'operator', password: 'password' })
    ).rejects.toThrow(/changed|Review/);
    expect(f.loadKey).not.toHaveBeenCalled();
    expect(
      f.runCrypto.mock.calls.some(([job]) =>
        ['sign', 'signVote'].includes(job.type)
      )
    ).toBe(false);
  }
);

it.each(['operations', 'votes'] as const)(
  'rechecks cancellation after key loading before %s signing',
  async (kind) => {
    const f = fixture();
    const controller = f[kind];
    const id = await controller.prepare(
      kind === 'votes' ? voteRequest : operationRequest,
      'https://dapp.example'
    );
    const entered = deferred(),
      finish = deferred();
    f.loadKey.mockImplementationOnce(async ({ assertCurrent }) => {
      entered.resolve();
      await finish.promise;
      assertCurrent();
      return kind === 'votes' ? votingKey : operatorKey;
    });
    const signing =
      kind === 'votes'
        ? f.votes.sign({ id, password: 'password' })
        : f.operations.sign({ id, keyId: 'operator', password: 'password' });
    await entered.promise;
    controller.cancel(id);
    finish.resolve();
    await expect(signing).rejects.toThrow(/expired|cancelled/);
    expect(
      f.runCrypto.mock.calls.some(([job]) =>
        ['sign', 'signVote'].includes(job.type)
      )
    ).toBe(false);
  }
);

it('rechecks the captured owner after queued work and never exposes key inventory as a signing result', async () => {
  const f = fixture();
  const id = await f.votes.prepare(voteRequest, 'https://dapp.example');
  const entered = deferred(),
    finish = deferred();
  const before = f.host.runExclusive(async () => {
    entered.resolve();
    await finish.promise;
  });
  await entered.promise;
  const signing = f.votes.sign({ id, password: 'password' });
  f.changeScope();
  finish.resolve();
  await before;
  await expect(signing).rejects.toThrow('context changed');
  expect(f.getSeed).not.toHaveBeenCalled();
  expect(f.loadKey).not.toHaveBeenCalled();
});
