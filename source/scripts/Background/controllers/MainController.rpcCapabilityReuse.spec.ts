jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: { activeNetwork: mockNetwork } }) },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-keyring'),
  CustomJsonRpcProvider: jest.fn(
    (...args) =>
      new (jest.requireActual(
        '@sidhujag/sysweb3-keyring'
      ).CustomJsonRpcProvider)(...args)
  ),
}));

import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

import { createRpcReadCapabilitiesOwner } from '../../../shared/rpcReadCapabilities';

import MainController from './MainController';

const mockNetwork = {
  chainId: 31337,
  url: 'https://capability.test',
  kind: 'ethereum',
  slip44: 60,
};
const address = `0x${'11'.repeat(20)}`;
const methods = [
  { method: 'eth_getBalance', params: [address, 'latest'] },
  { method: 'eth_getBalance', params: [address, 'pending'] },
];
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

it('borrows only matching live provider capability metadata across owned reads', async () => {
  const actual = jest.requireActual(
    '@sidhujag/sysweb3-keyring'
  ).CustomJsonRpcProvider;
  const capabilities = createRpcReadCapabilitiesOwner().get(
    '31337',
    mockNetwork.url
  );
  const widths: number[] = [];
  let value = '0x1';
  global.fetch = jest.fn(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    widths.push(Array.isArray(body) ? body.length : 1);
    return Response.json(
      Array.isArray(body)
        ? {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Batch unsupported' },
          }
        : { jsonrpc: '2.0', id: body.id, result: value }
    );
  });
  const original = new actual(
    new AbortController().signal,
    mockNetwork.url,
    mockNetwork.chainId,
    { capabilities }
  );
  // The published fallback lacks the new accessor; emulate its metadata-only contract.
  Object.defineProperty(original, 'readCapabilities', { value: capabilities });
  const wallet: any = Object.create(MainController.prototype);
  wallet.rpcReadCapabilities = createRpcReadCapabilitiesOwner();
  try {
    await original.readMany(methods);
    value = '0x2';
    const results = await wallet.withReceiptReadProvider(
      new AbortController().signal,
      mockNetwork,
      (provider: CustomJsonRpcProvider) => provider.readMany(methods),
      original
    );
    expect(widths).toEqual([2, 1, 1, 1, 1]);
    expect(results.map((row: any) => row.value)).toEqual(['0x2', '0x2']);
    expect(
      jest.mocked(CustomJsonRpcProvider).mock.calls.at(-1)?.[3]?.capabilities
    ).toBe(capabilities);
    expect(original.signal.aborted).toBe(false);
    await original.readMany(methods);

    await wallet.withReceiptReadProvider(
      new AbortController().signal,
      { ...mockNetwork, url: 'https://other.test' },
      async () => undefined,
      original
    );
    expect(
      jest.mocked(CustomJsonRpcProvider).mock.calls.at(-1)?.[3]?.capabilities
    ).not.toBe(capabilities);
    await wallet.withReceiptReadProvider(
      new AbortController().signal,
      { ...mockNetwork, chainId: 1 },
      async () => undefined,
      original
    );
    expect(
      jest.mocked(CustomJsonRpcProvider).mock.calls.at(-1)?.[3]?.capabilities
    ).not.toBe(capabilities);
  } finally {
    original.destroy();
  }
});

it('keeps the published provider fallback on the same chain capability owner', async () => {
  const wallet: any = Object.create(MainController.prototype);
  wallet.rpcReadCapabilities = createRpcReadCapabilitiesOwner();
  const expected = wallet.rpcReadCapabilities.get(
    String(mockNetwork.chainId),
    mockNetwork.url
  );
  const published = { _getConnection: () => ({ url: mockNetwork.url }) };
  await wallet.withReceiptReadProvider(
    new AbortController().signal,
    mockNetwork,
    async () => undefined,
    published
  );
  expect(
    jest.mocked(CustomJsonRpcProvider).mock.calls.at(-1)?.[3]?.capabilities
  ).toBe(expected);
});
