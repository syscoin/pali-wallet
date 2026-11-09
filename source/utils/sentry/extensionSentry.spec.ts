import { webcrypto } from 'crypto';

import {
  captureSentryCollateralAdmission,
  releaseSentryCollateral,
  reserveSentryCollateral,
} from './collateral';
import { createExtensionSentryNodeManagement } from './extensionSentry';
import { SENTRY_NETWORKS } from './network';

jest.mock('./collateral', () => ({
  captureSentryCollateralAdmission: jest.fn(),
  releaseSentryCollateral: jest.fn(),
  reserveSentryCollateral: jest.fn(),
}));

const node = {
  proTxHash: 'ab'.repeat(32),
  collateralOutpoint: { txid: 'cd'.repeat(32), vout: 2 },
  service: '127.0.0.1:8369',
  nevmAddress: '',
};
const reservation = { ...node.collateralOutpoint, proTxHash: node.proTxHash };
const request = {
  version: 1,
  proTxHash: node.proTxHash,
  genesisHash: SENTRY_NETWORKS.mainnet.genesisHash,
};

function fixture() {
  let scope = {
    identity: 'wallet-session',
    rootPublicIdentity: 'wallet-public-root',
    network: { chainId: 57, kind: 'syscoin', url: 'https://blockbook.example' },
  };
  const authenticate = jest.fn<Promise<unknown>, [string]>(
    async () => undefined
  );
  const manager = createExtensionSentryNodeManagement({
    captureScope: () => scope,
    assertCurrent(captured) {
      if (captured !== scope) throw new Error('Wallet session changed');
    },
    authenticate,
    readSettings: async () => ({
      network: 'mainnet',
      serviceUrl: 'https://sentry.example',
      maxFeeSatoshis: '1000',
      keys: [],
      linkedNodes: [],
      collateral: [reservation],
    }),
    runExclusive: async (operation) => operation(),
  });
  return {
    manager,
    authenticate,
    changeScope: () => {
      scope = { ...scope, identity: 'locked' };
    },
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  Object.defineProperty(global, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  (captureSentryCollateralAdmission as jest.Mock).mockResolvedValue({
    key: 'collateral',
    generation: 0,
  });
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({ chain: { genesisHash: request.genesisHash }, node })
      )
  );
});

it('binds the original wallet/network admission to one atomic reviewed-node reservation', async () => {
  const f = fixture();
  const review = await f.manager.prepareLink(request, 'https://dapp.example');
  await f.manager.confirmLink(review);
  expect(captureSentryCollateralAdmission).toHaveBeenCalledTimes(1);
  expect(reserveSentryCollateral).toHaveBeenCalledTimes(1);
  expect(reserveSentryCollateral).toHaveBeenCalledWith({
    admission: { key: 'collateral', generation: 0 },
    walletIdentity: 'wallet-public-root',
    genesisHash: request.genesisHash,
    reservation,
    linkedNode: node,
    assertCurrent: expect.any(Function),
  });
  expect(f.authenticate).not.toHaveBeenCalled();
});

it('authenticates release freshly and passes its exact reservation and captured scope to the registry', async () => {
  const f = fixture();
  await expect(
    f.manager.releaseCollateral({
      reservation,
      password: 'fresh password',
      acknowledgeNodeStops: false,
    })
  ).rejects.toThrow('Confirm');
  expect(f.authenticate).not.toHaveBeenCalled();
  await expect(
    f.manager.releaseCollateral({
      reservation,
      password: 'fresh password',
      acknowledgeNodeStops: true,
    })
  ).resolves.toEqual(reservation);
  expect(f.authenticate).toHaveBeenCalledWith('fresh password');
  expect(releaseSentryCollateral).toHaveBeenCalledWith({
    walletIdentity: 'wallet-public-root',
    genesisHash: request.genesisHash,
    reservation,
    assertCurrent: expect.any(Function),
  });
});

it('rejects a wallet/session change during password confirmation before the release write', async () => {
  const f = fixture();
  f.authenticate.mockImplementationOnce(async () => {
    f.changeScope();
  });
  await expect(
    f.manager.releaseCollateral({
      reservation,
      password: 'password',
      acknowledgeNodeStops: true,
    })
  ).rejects.toThrow('session changed');
  expect(releaseSentryCollateral).not.toHaveBeenCalled();
});
