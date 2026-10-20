import { createRequire } from 'module';

let mockState: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => {
      mockState = {
        ...mockState,
        vaultGlobal: jest
          .requireActual('state/vaultGlobal')
          .default(mockState.vaultGlobal, action),
      };
      return action;
    },
  },
}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: {},
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => {
  const nativeRequire = jest
    .requireActual('module')
    .createRequire(require.resolve('@sidhujag/sysweb3-keyring/package.json'));
  return {
    KeyringManager: jest.fn(),
    CustomJsonRpcProvider:
      nativeRequire('./cjs/providers').CustomJsonRpcProvider,
    PsbtUtils: {},
  };
});

import { selectEnsNameToAddress } from 'state/vault/selectors';
import vaultGlobalReducer from 'state/vaultGlobal';

import MainController from './MainController';

// Resolve the installed dependency natively, not through a replacement ENS
// implementation. Only its contract-read transport receives synthetic data.
const nativeRequire = createRequire(
  require.resolve('@sidhujag/sysweb3-keyring/package.json')
);
const { CustomJsonRpcProvider } = nativeRequire('./cjs/providers');
const { Interface } = nativeRequire('ethers/abi');
const { dnsEncode, namehash } = nativeRequire('ethers/hash');
const UNIVERSAL = '0xeeeeeeee14d718c2b47d9923deab1335e144eeee';
const RESOLVER = `0x${'44'.repeat(20)}`;
const DIRECT = `0x${'11'.repeat(20)}`;
const WILDCARD = `0x${'22'.repeat(20)}`;
const ZERO = `0x${'00'.repeat(20)}`;
const universalInterface = new Interface([
  'function requireResolver(bytes) view returns ((bytes name, uint256 offset, bytes32 node, address resolver, bool extended))',
]);
const resolverInterface = new Interface([
  'function addr(bytes32) view returns (address)',
  'function resolve(bytes, bytes) view returns (bytes)',
]);
const originalFetch = global.fetch;
let wallet: any;

beforeEach(() => {
  global.fetch = jest.fn(async () => {
    throw new Error('Public I/O is forbidden in this ENS provider fixture');
  }) as any;
  const globalState = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockState = {
    vaultGlobal: {
      ...globalState,
      networks: {
        ...globalState.networks,
        ethereum: {
          1: { chainId: 1, url: 'https://ens-mainnet.invalid' },
        },
      },
    },
  };
  wallet = Object.create(MainController.prototype);
  wallet.walletStateGeneration = 0;
  wallet.ensResolutionRequests = new Map();
  wallet.persistentProviders = new Map();
  wallet.persistentProviderAbortControllers = new Map();
});

afterEach(() => {
  for (const controller of wallet.persistentProviderAbortControllers.values())
    (controller as AbortController).abort();
  for (const provider of wallet.persistentProviders.values())
    provider.destroy();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

it('uses the installed ethers Universal Resolver for ordinary and wildcard batch names', async () => {
  const provider = wallet.getEnsMainnetProvider();
  expect(provider).toBeInstanceOf(CustomJsonRpcProvider);
  const network = await provider.getNetwork();
  expect(network.chainId).toBe(BigInt(1));
  expect(
    network
      .getPlugin('org.ethers.plugins.network.Ens')
      .universalResolver.toLowerCase()
  ).toBe(UNIVERSAL);

  const records = [
    { name: 'direct.eth', address: DIRECT, extended: false },
    { name: 'child.wildcard.eth', address: WILDCARD, extended: true },
    { name: 'unassigned.eth', address: ZERO, extended: false },
  ];
  const reads: Array<{ method: string; name: string; to: string }> = [];
  const unexpectedReads: string[] = [];
  jest.spyOn(provider, 'call').mockImplementation(async (transaction: any) => {
    const to = String(transaction.to).toLowerCase();
    if (to === UNIVERSAL) {
      const parsed = universalInterface.parseTransaction(transaction);
      const record = records.find(
        ({ name }) => dnsEncode(name) === parsed.args[0]
      );
      if (parsed.name !== 'requireResolver' || !record)
        throw new Error('Unexpected Universal Resolver fixture request');
      reads.push({ method: parsed.name, name: record.name, to });
      return universalInterface.encodeFunctionResult('requireResolver', [
        [
          dnsEncode(record.name),
          0,
          namehash(record.name),
          RESOLVER,
          record.extended,
        ],
      ]);
    }
    if (to === RESOLVER.toLowerCase()) {
      const parsed = resolverInterface.parseTransaction(transaction);
      const extended = parsed.name === 'resolve';
      const inner = extended
        ? resolverInterface.parseTransaction({ data: parsed.args[1] })
        : parsed;
      const record = records.find(
        ({ name }) => namehash(name) === inner.args[0]
      );
      if (!record || inner.name !== 'addr' || extended !== record.extended)
        throw new Error('Unexpected resolver fixture request');
      if (extended) expect(parsed.args[0]).toBe(dnsEncode(record.name));
      reads.push({ method: parsed.name, name: record.name, to });
      const addressResult = resolverInterface.encodeFunctionResult('addr', [
        record.address,
      ]);
      return extended
        ? resolverInterface.encodeFunctionResult('resolve', [addressResult])
        : addressResult;
    }
    unexpectedReads.push(to);
    throw new Error(`Unexpected contract read: ${to}`);
  });

  const result = await wallet.batchResolveEns(records.map(({ name }) => name));
  expect(result).toEqual({
    'direct.eth': DIRECT,
    'child.wildcard.eth': WILDCARD,
    'unassigned.eth': null,
  });
  expect(selectEnsNameToAddress(mockState)).toEqual({
    'direct.eth': DIRECT,
    'child.wildcard.eth': WILDCARD,
  });
  expect(reads).toHaveLength(6);
  expect(
    reads.filter(({ method }) => method === 'requireResolver')
  ).toHaveLength(3);
  expect(reads).toContainEqual({
    method: 'resolve',
    name: 'child.wildcard.eth',
    to: RESOLVER.toLowerCase(),
  });
  expect(unexpectedReads).toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(wallet.ensResolutionRequests.size).toBe(0);
});
