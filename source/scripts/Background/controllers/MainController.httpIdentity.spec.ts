/** @jest-environment node */
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
const mockGetEthRpc = jest.fn();
const mockObserveSysRpc = jest.fn();
const mockValidate = jest.fn();
const mockEndpoint = jest.fn();
let mockReady: Promise<void>;
jest.mock('@sidhujag/sysweb3-network', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-network'),
  getEthRpc: (...args: any[]) => mockGetEthRpc(...args),
  observeSysRpc: (...args: any[]) => mockObserveSysRpc(...args),
  validateEvmRpcBatch: (...args: any[]) => mockValidate(...args),
}));
jest.mock('./providers/walletHttpIdentity', () => ({
  withWalletBackend: (url: string, operation: () => Promise<unknown>) => {
    mockEndpoint(url);
    return mockReady.then(operation);
  },
}));
import MainController from './MainController';

for (const kind of ['ethereum', 'syscoin', 'quality', 'explorer'] as const) {
  test(`candidate ${kind} probe waits for its exact endpoint rule before existing SDK call`, async () => {
    jest.clearAllMocks();
    let release!: () => void;
    mockReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    const network = {
      url:
        kind === 'syscoin'
          ? 'https://rpc.public-fixture.invalid/path'
          : 'https://rpc.public-fixture.invalid/path?public=value',
      isSyscoinRpc: kind === 'syscoin',
    };
    mockGetEthRpc.mockResolvedValue({ formattedNetwork: network });
    mockObserveSysRpc.mockResolvedValue({ rpc: { formattedNetwork: network } });
    mockValidate.mockResolvedValue({ success: true });
    const explorer = jest.fn().mockResolvedValue({ success: true });
    const wallet = Object.create(MainController.prototype) as MainController;
    (wallet as any).evmTransactionsController = { testExplorerApi: explorer };
    (wallet as any).isUnlocked = () => true;
    const result =
      kind === 'quality'
        ? wallet.testRpcConnection(network.url, 'ethereum' as any, 1)
        : kind === 'explorer'
        ? wallet.testExplorerApi(network.url)
        : kind === 'syscoin'
        ? wallet.previewUtxoRpc({
            purpose: 'first-use',
            url: network.url,
            label: 'Synthetic',
          })
        : wallet.getRpc(network as any);
    expect(mockEndpoint).toHaveBeenCalledWith(network.url);
    for (const probe of [
      mockGetEthRpc,
      mockObserveSysRpc,
      mockValidate,
      explorer,
    ])
      expect(probe).not.toHaveBeenCalled();
    release();
    await result;
    expect(
      kind === 'quality'
        ? mockValidate
        : kind === 'explorer'
        ? explorer
        : kind === 'syscoin'
        ? mockObserveSysRpc
        : mockGetEthRpc
    ).toHaveBeenCalledTimes(1);
  });
}
