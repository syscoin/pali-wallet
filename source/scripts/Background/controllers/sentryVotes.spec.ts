import { webcrypto } from 'crypto';

import { AsyncMutex } from 'utils/asyncMutex';

import { SentryVoteController } from './sentryVotes';

const mockLoadKey = jest.fn();
const mockCrypto = jest.fn();
const mockVerify = jest.fn();
jest.mock('utils/sentry/keyStore', () => ({
  getSentryVaultId: async () => 'synthetic-vault',
  loadSentryKey: (...args: unknown[]) => mockLoadKey(...args),
}));
jest.mock('utils/sentry/workerClient', () => ({
  runSentryCrypto: (...args: unknown[]) => mockCrypto(...args),
}));
jest.mock(
  '@sidhujag/sysweb3-sentry',
  () => ({
    validateSentryGovernanceVoteRequest: (value: any) => {
      if (value.version !== 1) throw new Error('Invalid request');
      return structuredClone(value);
    },
    reviewSentryGovernanceVote: (request: any, context: any) => {
      if (
        request.chain.genesisHash !== context.chain.genesisHash ||
        context.chain.era !== 'legacy-v3'
      )
        throw new Error('Wrong network');
      if (request.proposalHash !== context.proposalHash)
        throw new Error('Wrong proposal');
      if (Math.abs(request.timestamp - context.now) > 3600)
        throw new Error('Stale vote');
      if (context.nodes.length !== request.nodes.length)
        throw new Error('Missing node');
      return { request };
    },
    governanceVotingKeyIds: async (publicKey: string) => ({
      compressed: publicKey.slice(2, 42),
      uncompressed: '22'.repeat(20),
    }),
    verifySentryGovernanceVote: (...args: unknown[]) => mockVerify(...args),
  }),
  { virtual: true }
);

const genesis =
  '0000066e1a6b9cfeac8295dce0cc8d9170690a74bc4878cf8a0b412554f5c222';
const key = {
  role: 'voting',
  scheme: 'secp256k1',
  publicKey: '02' + '11'.repeat(32),
  secretKey: 'c7'.repeat(32),
};
let scope: any;
let request: any;
let context: any;
let settings: any;
let readJson: jest.Mock;
let getSeed: jest.Mock;
let controller: SentryVoteController;

beforeEach(() => {
  Object.defineProperty(global, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  jest.clearAllMocks();
  scope = {
    identity: 'session-one',
    rootPublicIdentity: 'test-xpub',
    network: { chainId: 5700, kind: 'syscoin', url: 'https://blockbook.test' },
  };
  request = {
    version: 1,
    chain: { genesisHash: genesis, era: 'legacy-v3' },
    proposalHash: '9a'.repeat(32),
    signal: 'funding',
    outcome: 'yes',
    timestamp: Math.floor(Date.now() / 1000),
    nodes: [
      {
        proTxHash: 'a1'.repeat(32),
        collateralOutpoint: { txid: 'b1'.repeat(32), vout: 1 },
      },
      {
        proTxHash: 'a2'.repeat(32),
        collateralOutpoint: { txid: 'b2'.repeat(32), vout: 2 },
      },
    ],
  };
  context = {
    chain: request.chain,
    proposalHash: request.proposalHash,
    proposal: { name: 'Verified proposal', url: 'https://proposal.test' },
    now: request.timestamp,
    nodes: request.nodes.map((node: any) => ({
      ...node,
      votingKeyId: '11'.repeat(20),
      valid: true,
    })),
  };
  settings = {
    network: 'testnet',
    serviceUrl: 'https://trusted.test',
    keys: [{ ...key, id: 'key-one', label: 'Voting key', network: 'testnet' }],
  };
  readJson = jest.fn(async () => structuredClone(context));
  getSeed = jest.fn(async () => 'private-synthetic-seed');
  mockLoadKey.mockResolvedValue(key);
  mockVerify.mockResolvedValue(true);
  mockCrypto.mockImplementation(async (job, assertCurrent) => {
    assertCurrent();
    return {
      proTxHash: job.proTxHash,
      collateralOutpoint: request.nodes.find(
        (node: any) => node.proTxHash === job.proTxHash
      ).collateralOutpoint,
      voteSig: 'c2lnbmF0dXJl',
      signatureHash: '55'.repeat(32),
      voteHash: '66'.repeat(32),
    };
  });
  const mutex = new AsyncMutex();
  controller = new SentryVoteController({
    captureScope: () => scope,
    getSeed,
    getSettings: async () => settings,
    readJson,
    runExclusive: (job) => mutex.runExclusive(job),
  });
});

it('signs only the reviewed batch and never returns key material', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  expect(controller.getApproval(id).nodes).toHaveLength(2);
  expect(readJson.mock.calls[0][0]).toMatch(
    /^https:\/\/trusted\.test\/api\/sentry\/v1\/voting-context\?/
  );
  expect(getSeed).not.toHaveBeenCalled();
  const result = await controller.sign({ id, password: 'synthetic-password' });
  expect(result.votes.map((vote) => vote.proTxHash)).toEqual(
    request.nodes.map((node: any) => node.proTxHash)
  );
  expect(mockCrypto).toHaveBeenCalledTimes(2);
  expect(mockVerify).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toContain(key.secretKey);
  expect(JSON.stringify(result)).not.toContain('private-synthetic-seed');
  expect(() => controller.getApproval(id)).toThrow('expired');
});

it('uses the wallet clock instead of a service-controlled timestamp', async () => {
  context.now += 86400;
  await expect(
    controller.prepare(request, 'https://dapp.test')
  ).resolves.toEqual(expect.any(String));
});

it('rejects wrong networks before contacting any service', async () => {
  request.chain.genesisHash = '77'.repeat(32);
  await expect(
    controller.prepare(request, 'https://dapp.test')
  ).rejects.toThrow('Switch');
  expect(readJson).not.toHaveBeenCalled();
});

it('rejects a mismatched service genesis and unknown proposal', async () => {
  context.chain = { ...context.chain, genesisHash: '77'.repeat(32) };
  await expect(
    controller.prepare(request, 'https://dapp.test')
  ).rejects.toThrow('genesis');
  context.chain = request.chain;
  delete context.proposal;
  await expect(
    controller.prepare(request, 'https://dapp.test')
  ).rejects.toThrow('registered proposal');
});

it('does not treat an operator key as a voting key', async () => {
  settings.keys[0].role = 'operator';
  await expect(
    controller.prepare(request, 'https://dapp.test')
  ).rejects.toThrow(request.nodes[0].proTxHash);
  expect(mockCrypto).not.toHaveBeenCalled();
});

it('rechecks voting registration and proposal metadata before signing', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  context.nodes[0].votingKeyId = '33'.repeat(20);
  await expect(controller.sign({ id, password: 'synthetic' })).rejects.toThrow(
    'changed'
  );
  expect(mockCrypto).not.toHaveBeenCalled();
  context.nodes[0].votingKeyId = '11'.repeat(20);
  context.proposal.name = 'Different proposal label';
  await expect(controller.sign({ id, password: 'synthetic' })).rejects.toThrow(
    'changed'
  );
});

it('retires cancelled and old-account approvals without exposing partial signatures', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  controller.cancel(id);
  await expect(controller.sign({ id, password: 'synthetic' })).rejects.toThrow(
    'expired'
  );
  const next = await controller.prepare(request, 'https://dapp.test');
  scope = { ...scope, identity: 'new-account' };
  await expect(
    controller.sign({ id: next, password: 'synthetic' })
  ).rejects.toThrow('session changed');
  expect(mockCrypto).not.toHaveBeenCalled();
});

it('rejects duplicate clicks and cancellation while cryptography is running', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  let release!: () => void;
  mockCrypto.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ proTxHash: request.nodes[0].proTxHash });
      })
  );
  const signing = controller.sign({ id, password: 'synthetic' });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  await expect(controller.sign({ id, password: 'synthetic' })).rejects.toThrow(
    'already'
  );
  controller.cancel(id);
  release();
  await expect(signing).rejects.toThrow('expired');
  expect(mockCrypto).toHaveBeenCalledTimes(1);
});

it('does not return an invalid generated signature', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  mockVerify.mockResolvedValue(false);
  await expect(controller.sign({ id, password: 'synthetic' })).rejects.toThrow(
    'does not match'
  );
});
