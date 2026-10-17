import { webcrypto } from 'crypto';

import {
  captureSentryCollateralAdmission,
  reserveSentryCollateral,
} from 'utils/sentry/collateral';
import {
  listSentryKeys,
  loadSentryKey,
  saveSentryKey,
} from 'utils/sentry/keyStore';
import { SENTRY_NETWORKS } from 'utils/sentry/network';
import { runSentryCrypto } from 'utils/sentry/workerClient';
import { chromeStorage } from 'utils/storageAPI';

import { SentryController, SentryWalletScope } from './sentry';

jest.mock(
  '@sidhujag/sysweb3-sentry',
  () => ({
    validateSentryOperationRequest: (value: unknown) => value,
    validateSentryManagementRequest: (value: unknown) => value,
    inspectSentryManagementOperation: (value: any) =>
      value.operation === 'register'
        ? {
            collateral: { txid: '22'.repeat(32), vout: 1 },
            inputTxids: ['cd'.repeat(32)],
          }
        : { proTxHash: 'ab'.repeat(32), inputTxids: ['cd'.repeat(32)] },
    sentryKeyId: () => 'aa'.repeat(20),
    reviewSentryManagementOperation: (value: any) => ({
      operation: value.operation,
      chain: value.chain,
      proTxHash: 'ab'.repeat(32),
      feeSatoshis: '1000',
      outputs: [],
      fields: { payoutAddress: 'synthetic-address' },
      authorizations: [
        {
          id: 'owner',
          role: 'owner',
          scheme: 'secp256k1',
          keyIdentity: 'aa'.repeat(20),
          signed: false,
        },
      ],
    }),
    inspectSentryOperation: () => ({
      proTxHash: 'ab'.repeat(32),
      inputTxids: ['cd'.repeat(32)],
    }),
    reviewSentryOperation: (request: any, context: any) => ({
      operation: 'updateService',
      scheme: 'bls-basic',
      proTxHash: context.node.proTxHash,
      changes: { nevmAddress: { previous: '', next: '0x' + '12'.repeat(20) } },
      chain: request.chain,
      feeSatoshis: '1000',
      outputs: [],
      authorizationHash: 'ef'.repeat(32),
    }),
  }),
  { virtual: true }
);
jest.mock('syscoinjs-lib', () => ({
  utils: {
    bitcoinjs: {
      address: { toBase58Check: () => 'synthetic-owner-address' },
      Transaction: {
        fromHex: () => ({
          ins: [
            { hash: Buffer.from('cd'.repeat(32), 'hex').reverse(), index: 0 },
          ],
        }),
      },
    },
  },
}));
jest.mock('utils/sentry/keyStore', () => ({
  getSentryVaultId: async () => 'vault-id',
  listSentryKeys: jest.fn(),
  loadSentryKey: jest.fn(),
  saveSentryKey: jest.fn(),
  removeSentryKey: jest.fn(),
}));
jest.mock('utils/sentry/workerClient', () => ({ runSentryCrypto: jest.fn() }));
jest.mock('utils/sentry/collateral', () => ({
  captureSentryCollateralAdmission: jest.fn(),
  reserveSentryCollateral: jest.fn(),
  getSentryCollateralReservations: async () => [],
  releaseSentryCollateral: jest.fn(),
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));

const publicKey = 'bb'.repeat(48);
const imported = { scheme: 'bls-basic', publicKey, secretKey: '11'.repeat(32) };
const summary = {
  id: 'operator-id',
  scheme: 'bls-basic',
  publicKey,
  label: 'Operator',
  role: 'operator',
  network: 'mainnet',
};
const request = {
  version: 1,
  operation: 'updateService',
  chain: { genesisHash: SENTRY_NETWORKS.mainnet.genesisHash, era: 'legacy-v3' },
  transactionHex: '0100',
};
let scope: SentryWalletScope;
let observation: any;
let controller: SentryController;
let getSeed: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  (captureSentryCollateralAdmission as jest.Mock).mockResolvedValue({
    key: 'fixture',
    generation: 0,
  });
  Object.defineProperty(global, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  scope = {
    identity: 'scope-1',
    rootPublicIdentity: 'xpub-root',
    network: { kind: 'syscoin', chainId: 57, url: 'https://blockbook.test' },
  };
  observation = {
    chain: request.chain,
    node: {
      proTxHash: 'ab'.repeat(32),
      operatorPublicKey: publicKey,
      service: '1.2.3.4:8369',
      nevmAddress: '',
      operatorPayoutScript: '',
      confirmedHash: 'fa'.repeat(32),
      poseBanHeight: -1,
      collateralOutpoint: { txid: '22'.repeat(32), vout: 1 },
    },
  };
  getSeed = jest.fn().mockResolvedValue('private-seed');
  controller = new SentryController({ captureScope: () => scope, getSeed });
  (chromeStorage.getItem as jest.Mock).mockResolvedValue(null);
  (listSentryKeys as jest.Mock).mockResolvedValue([summary]);
  (loadSentryKey as jest.Mock).mockResolvedValue(imported);
  (saveSentryKey as jest.Mock).mockResolvedValue(summary);
  (runSentryCrypto as jest.Mock).mockResolvedValue({
    version: 1,
    operation: 'updateService',
    transactionHex: 'signed-public-bytes',
  });
  global.fetch = jest
    .fn()
    .mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes('/context?') ? observation : { hex: '0100' }
          )
        )
    );
});

it('prepares a public-only scoped review using fixed configured service and independent funding reads', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  const review = controller.getApproval(id);
  expect(review.origin).toBe('https://dapp.test');
  expect(review.keys).toEqual([summary]);
  expect(JSON.stringify(review)).not.toContain(imported.secretKey);
  expect(JSON.stringify(review)).not.toContain('private-seed');
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('https://sysnode.info/api/sentry/v1/context?'),
    expect.objectContaining({ credentials: 'omit', redirect: 'error' })
  );
  expect(global.fetch).toHaveBeenCalledWith(
    'https://blockbook.test/api/v2/tx/' + 'cd'.repeat(32),
    expect.any(Object)
  );
});

it('refuses a mismatched genesis before generating an approval', async () => {
  observation.chain = { ...request.chain, genesisHash: 'ff'.repeat(32) };
  await expect(
    controller.prepare(request, 'https://dapp.test')
  ).rejects.toThrow('different network genesis');
  expect(runSentryCrypto).not.toHaveBeenCalled();
});

it('cancels an oversized chunked response before buffering it, even without Content-Length', async () => {
  const cancelled = jest.fn();
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(new Uint8Array(65536));
          stream.enqueue(new Uint8Array(1));
        },
        cancel: cancelled,
      })
    )
  );
  await expect(
    controller.prepare(request, 'https://dapp.test')
  ).rejects.toThrow('response is too large');
  expect(cancelled).toHaveBeenCalledTimes(1);
  expect(runSentryCrypto).not.toHaveBeenCalled();
});

it('rejects use of registered collateral as a funding input', async () => {
  observation.node.collateralOutpoint = { txid: 'cd'.repeat(32), vout: 0 };
  await expect(
    controller.prepare(request, 'https://dapp.test')
  ).rejects.toThrow('collateral cannot fund');
});

it('invalidates pending approvals on account/network/session changes', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  scope = { ...scope, identity: 'scope-2' };
  expect(() => controller.getApproval(id)).toThrow('session changed');
  await expect(
    controller.sign({ id, keyId: summary.id, password: 'pw' })
  ).rejects.toThrow('session changed');
  expect(runSentryCrypto).not.toHaveBeenCalled();
});

it('authorizes once only after fresh unchanged state and local reauthentication', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  const response = await controller.sign({
    id,
    keyId: summary.id,
    password: 'pw',
  });
  expect(response.transactionHex).toBe('signed-public-bytes');
  expect(getSeed).toHaveBeenCalledWith('pw');
  expect(runSentryCrypto).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'sign', key: imported }),
    expect.any(Function)
  );
  await expect(
    controller.sign({ id, keyId: summary.id, password: 'pw' })
  ).rejects.toThrow('expired');
});

it('never signs after registered state changes while the review is open', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  observation = {
    ...observation,
    node: { ...observation.node, nevmAddress: '0x' + '99'.repeat(20) },
  };
  await expect(
    controller.sign({ id, keyId: summary.id, password: 'pw' })
  ).rejects.toThrow('state changed');
  expect(runSentryCrypto).not.toHaveBeenCalled();
});

it('accepts identical refreshed JSON with reordered nested object keys', async () => {
  observation.registration = {
    collateralVout: 1,
    requiredCollateralSatoshis: '100000',
    metadata: { active: true, values: ['first', 'second'] },
  };
  const id = await controller.prepare(request, 'https://dapp.test');
  const reorder = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reorder);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, entry]) => [key, reorder(entry)])
      );
    return value;
  };
  observation = reorder(observation);
  await expect(
    controller.sign({ id, keyId: summary.id, password: 'pw' })
  ).resolves.toMatchObject({ transactionHex: 'signed-public-bytes' });
  expect(runSentryCrypto).toHaveBeenCalledTimes(1);
});

it.each(['collateral', 'registration', 'array order'])(
  'rejects changed refreshed %s data despite stable object keys',
  async (change) => {
    observation.registration = {
      collateralVout: 1,
      requiredCollateralSatoshis: '100000',
      metadata: { active: true, values: ['first', 'second'] },
    };
    const id = await controller.prepare(request, 'https://dapp.test');
    if (change === 'collateral') observation.node.collateralOutpoint.vout = 2;
    else if (change === 'registration')
      observation.registration.requiredCollateralSatoshis = '100001';
    else observation.registration.metadata.values.reverse();
    await expect(
      controller.sign({ id, keyId: summary.id, password: 'pw' })
    ).rejects.toThrow('state changed');
    expect(runSentryCrypto).not.toHaveBeenCalled();
  }
);

it.each(['network', 'fee policy', 'operator key'])(
  'never signs after the reviewed %s changes',
  async (change) => {
    const id = await controller.prepare(request, 'https://dapp.test');
    if (change === 'network')
      observation.chain = {
        ...observation.chain,
        genesisHash: 'ff'.repeat(32),
      };
    else if (change === 'operator key')
      observation.node.operatorPublicKey = 'cc'.repeat(48);
    else
      (chromeStorage.getItem as jest.Mock).mockImplementation(async (name) =>
        name.startsWith('sentry-settings-v1:')
          ? { maxFeeSatoshis: '100001' }
          : null
      );
    await expect(
      controller.sign({ id, keyId: summary.id, password: 'pw' })
    ).rejects.toThrow();
    expect(runSentryCrypto).not.toHaveBeenCalled();
  }
);

it('drops a cancelled approval and requires a matching registered local key', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  await expect(
    controller.sign({ id, keyId: 'other-key', password: 'pw' })
  ).rejects.toThrow('registered operator key');
  controller.cancel(id);
  expect(() => controller.getApproval(id)).toThrow('expired');
  expect(runSentryCrypto).not.toHaveBeenCalled();
});

it('rejects invalid key sizes before offscreen work and rejects a wrong wallet password', async () => {
  await expect(
    controller.importKey({
      scheme: 'bls-basic',
      secretKey: 'ab',
      label: 'Node',
      password: 'pw',
    })
  ).rejects.toThrow('complete hexadecimal');
  getSeed.mockRejectedValueOnce(new Error('Invalid password'));
  await expect(
    controller.importKey({
      scheme: 'bls-basic',
      secretKey: '11'.repeat(32),
      label: 'Node',
      password: 'wrong',
    })
  ).rejects.toThrow('Invalid password');
  expect(runSentryCrypto).not.toHaveBeenCalled();
});

it('links verified public node identity without signing or importing collateral', async () => {
  const id = await controller.prepareLink(
    {
      version: 1,
      proTxHash: observation.node.proTxHash,
      genesisHash: request.chain.genesisHash,
    },
    'https://dapp.test'
  );
  expect(controller.getLinkApproval(id).node.collateralOutpoint).toEqual(
    observation.node.collateralOutpoint
  );
  expect(await controller.approveLink(id)).toEqual({
    version: 1,
    linked: true,
    proTxHash: observation.node.proTxHash,
    genesisHash: request.chain.genesisHash,
  });
  expect(chromeStorage.setItem).toHaveBeenCalledWith(
    'sentry-linked-v1:vault-id:mainnet',
    [expect.objectContaining({ proTxHash: observation.node.proTxHash })]
  );
  expect(runSentryCrypto).not.toHaveBeenCalled();
  expect(getSeed).not.toHaveBeenCalled();
});

it('retains the initial link admission token through the fresh state read', async () => {
  const original = { key: 'fixture', generation: 0 };
  const refreshed = { key: 'fixture', generation: 2 };
  (captureSentryCollateralAdmission as jest.Mock)
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce(refreshed);
  const id = await controller.prepareLink(
    {
      version: 1,
      proTxHash: observation.node.proTxHash,
      genesisHash: request.chain.genesisHash,
    },
    'https://dapp.test'
  );
  await controller.approveLink(id);
  expect(reserveSentryCollateral).toHaveBeenCalledWith(
    expect.objectContaining({ admission: original })
  );
});

it('accepts a link refresh with reordered collateral fields', async () => {
  const id = await controller.prepareLink(
    {
      version: 1,
      proTxHash: observation.node.proTxHash,
      genesisHash: request.chain.genesisHash,
    },
    'https://dapp.test'
  );
  observation.node.collateralOutpoint = {
    vout: observation.node.collateralOutpoint.vout,
    txid: observation.node.collateralOutpoint.txid,
  };
  await expect(controller.approveLink(id)).resolves.toMatchObject({
    linked: true,
    proTxHash: observation.node.proTxHash,
  });
});

it('rejects wrong-network link intent before touching the service', async () => {
  await expect(
    controller.prepareLink(
      {
        version: 1,
        proTxHash: observation.node.proTxHash,
        genesisHash: 'ff'.repeat(32),
      },
      'https://dapp.test'
    )
  ).rejects.toThrow('requested Syscoin network');
  expect(global.fetch).not.toHaveBeenCalled();
});

it('does not link if registered collateral changes between display and approval', async () => {
  const id = await controller.prepareLink(
    {
      version: 1,
      proTxHash: observation.node.proTxHash,
      genesisHash: request.chain.genesisHash,
    },
    'https://dapp.test'
  );
  observation = {
    ...observation,
    node: {
      ...observation.node,
      collateralOutpoint: { txid: '33'.repeat(32), vout: 3 },
    },
  };
  await expect(controller.approveLink(id)).rejects.toThrow(
    'state changed after review'
  );
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
});

it('retires link authorization when the wallet session changes', async () => {
  const id = await controller.prepareLink(
    {
      version: 1,
      proTxHash: observation.node.proTxHash,
      genesisHash: request.chain.genesisHash,
    },
    'https://dapp.test'
  );
  scope = { ...scope, identity: 'locked-session' };
  await expect(controller.approveLink(id)).rejects.toThrow('session changed');
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
});

it('does not treat an imported operator key as owner authority', async () => {
  const id = await controller.prepare(
    { ...request, operation: 'updateRegistrar' },
    'https://dapp.test'
  );
  expect(controller.getApproval(id).keys).toEqual([]);
  await expect(
    controller.sign({
      id,
      keyId: summary.id,
      password: 'pw',
      authorizationId: 'owner',
    })
  ).rejects.toThrow('registered operator key');
  expect(runSentryCrypto).not.toHaveBeenCalled();
});

it('resolves the selected wallet key only for the exact decoded owner address and authority slot', async () => {
  const resolver = jest
    .fn()
    .mockResolvedValue({ scheme: 'ecdsa', secretKey: '11'.repeat(32) });
  controller = new SentryController({
    captureScope: () => scope,
    getSeed,
    resolveWalletAuthority: resolver,
    hasWalletAuthority: async () => true,
  });
  (runSentryCrypto as jest.Mock).mockImplementation(async (job) =>
    job.type === 'import'
      ? {
          role: 'owner',
          scheme: 'secp256k1',
          publicKey: '02' + 'bb'.repeat(32),
          secretKey: '11'.repeat(32),
        }
      : {
          version: 1,
          operation: 'updateRegistrar',
          transactionHex: 'signed-management',
          complete: true,
          signedAuthorization: 'owner',
        }
  );
  const id = await controller.prepare(
    { ...request, operation: 'updateRegistrar' },
    'https://dapp.test'
  );
  expect(controller.getApproval(id).keys[0].id).toBe('wallet-owner');
  const response = await controller.sign({
    id,
    keyId: 'wallet-owner',
    password: 'pw',
    authorizationId: 'owner',
  });
  expect(resolver).toHaveBeenCalledWith(
    { address: 'synthetic-owner-address', password: 'pw' },
    scope
  );
  expect(response).toMatchObject({
    complete: true,
    signedAuthorization: 'owner',
  });
  expect(runSentryCrypto).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: 'signManagement',
      authorizationId: 'owner',
    }),
    expect.any(Function)
  );
});

it('preserves pending collateral before returning registration authorization, without inventing a node hash', async () => {
  const owner = {
    ...summary,
    id: 'owner-key',
    role: 'owner',
    scheme: 'secp256k1',
    publicKey: '02' + 'ab'.repeat(32),
  };
  (listSentryKeys as jest.Mock).mockResolvedValue([owner]);
  (loadSentryKey as jest.Mock).mockResolvedValue({
    ...owner,
    secretKey: '11'.repeat(32),
  });
  (runSentryCrypto as jest.Mock).mockImplementation(async (job) => {
    expect(reserveSentryCollateral).toHaveBeenCalledWith(
      expect.objectContaining({
        walletIdentity: scope.rootPublicIdentity,
        reservation: {
          txid: '22'.repeat(32),
          vout: 1,
          pendingRegistration: true,
        },
      })
    );
    return {
      version: 1,
      operation: job.request.operation,
      transactionHex: 'authorized-registration',
      complete: false,
      signedAuthorization: 'owner',
    };
  });
  const id = await controller.prepare(
    { ...request, operation: 'register' },
    'https://dapp.test'
  );
  await expect(
    controller.sign({
      id,
      keyId: owner.id,
      password: 'pw',
      authorizationId: 'owner',
    })
  ).resolves.toMatchObject({ complete: false });
  expect(runSentryCrypto).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'signManagement',
      authorizationId: 'owner',
    }),
    expect.any(Function)
  );
  expect(controller.getApproval.bind(controller, id)).toThrow('expired');
});

it('does not offer an unrelated active wallet key as owner authority', async () => {
  controller = new SentryController({
    captureScope: () => scope,
    getSeed,
    hasWalletAuthority: async () => false,
    resolveWalletAuthority: jest.fn(),
  });
  const id = await controller.prepare(
    { ...request, operation: 'updateRegistrar' },
    'https://dapp.test'
  );
  expect(controller.getApproval(id).keys).toEqual([]);
});

it('cancels a link during the fresh read without writing its identity or collateral', async () => {
  const input = {
    version: 1,
    proTxHash: observation.node.proTxHash,
    genesisHash: request.chain.genesisHash,
  };
  const id = await controller.prepareLink(input, 'https://dapp.test');
  let finishRead!: (value: unknown) => void;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  (global.fetch as jest.Mock).mockImplementationOnce(() => {
    started();
    return new Promise((resolve) => {
      finishRead = resolve;
    });
  });
  const approval = controller.approveLink(id);
  await reading;
  controller.cancelLink(id);
  finishRead(new Response(JSON.stringify(observation)));
  await expect(approval).rejects.toThrow('cancelled or expired');
  expect(reserveSentryCollateral).not.toHaveBeenCalled();
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
});

it('does not persist a linked registry larger than its readable limit', async () => {
  const input = {
    version: 1,
    proTxHash: observation.node.proTxHash,
    genesisHash: request.chain.genesisHash,
  };
  const id = await controller.prepareLink(input, 'https://dapp.test');
  (chromeStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
    key.startsWith('sentry-linked-v1:')
      ? Array.from({ length: 1000 }, (_, index) => ({
          proTxHash: index.toString(16).padStart(64, '0'),
        }))
      : null
  );
  await expect(controller.approveLink(id)).rejects.toThrow(
    'limit has been reached'
  );
  expect(reserveSentryCollateral).not.toHaveBeenCalled();
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
});

it('finishes an accepted link commit if cancellation arrives after the commit boundary', async () => {
  const id = await controller.prepareLink(
    {
      version: 1,
      proTxHash: observation.node.proTxHash,
      genesisHash: request.chain.genesisHash,
    },
    'https://dapp.test'
  );
  let finishReserve!: () => void;
  let committing!: () => void;
  const entered = new Promise<void>((resolve) => {
    committing = resolve;
  });
  (reserveSentryCollateral as jest.Mock).mockImplementationOnce(
    async (params) => {
      committing();
      await new Promise<void>((resolve) => {
        finishReserve = resolve;
      });
      params.assertCurrent();
    }
  );
  const approval = controller.approveLink(id);
  await entered;
  controller.cancelLink(id);
  finishReserve();
  await expect(approval).resolves.toMatchObject({ linked: true });
  expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
});
