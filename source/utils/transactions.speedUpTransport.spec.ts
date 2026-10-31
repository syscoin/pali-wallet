import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { getWalletNavigationScope } from 'utils/navigationState';
import {
  handleUpdateTransaction,
  previewSpeedUpTransaction,
  UpdateTxAction,
} from 'utils/transactions';

// Local controller transport fixture: every Chrome message is intercepted.
// It never opens a wallet, invokes an SDK signer, or contacts a network.
let mockVault: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({ vault: mockVault, vaultGlobal: { activeSlip44: 60 } }),
  },
}));
const ORIGINAL = `0x${'11'.repeat(32)}`;
const REPLACEMENT = `0x${'22'.repeat(32)}`;
const ACCOUNT = `0x${'33'.repeat(20)}`;
const FEE = '3024000000000000';
const rejection = {
  isSpeedUp: false,
  error: true,
  code: 'REPLACEMENT_VALUE_WOULD_CHANGE',
  message: 'Original amount is preserved',
};
const quote = { isSpeedUp: false, maximumFee: FEE };
const t = (key: string) => key;
let alert: { error: jest.Mock; warning: jest.Mock; success: jest.Mock };
let messages: any[];
let reply: (message: any, callback: (value: unknown) => void) => void;

beforeEach(() => {
  mockVault = {
    isBitcoinBased: false,
    activeAccount: { type: 'HDAccount', id: 0 },
    accounts: { HDAccount: { 0: { address: ACCOUNT } } },
    activeNetwork: {
      kind: 'ethereum',
      chainId: 5700,
      slip44: 60,
      url: 'https://rpc.synthetic.invalid',
    },
  };
  alert = { error: jest.fn(), warning: jest.fn(), success: jest.fn() };
  messages = [];
  (chrome.runtime as any).id = 'pali';
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((
    message: any,
    callback: (value: unknown) => void
  ) => {
    messages.push(message);
    reply(message, callback);
  }) as any);
});
afterEach(() => jest.restoreAllMocks());

const route = (message: any) => message.data.methods.join('.');
const submit = (scope: ReturnType<typeof getWalletNavigationScope>) =>
  handleUpdateTransaction({
    t,
    updateData: {
      alert,
      chainId: 5700,
      isLegacy: false,
      txHash: ORIGINAL,
      signerAddress: ACCOUNT,
      updateType: UpdateTxAction.SpeedUp,
      approvedMaximumFee: FEE,
      walletScope: scope,
    },
  });
const originalRoute = 'wallet.ethereumTransaction.sendTransactionWithEditedFee';

it('shows amount guidance for an SDK-shaped rejection through the real emitter', async () => {
  reply = (message, callback) => {
    expect(route(message)).toBe(originalRoute);
    callback(message.data.params[2].previewOnly ? quote : rejection);
  };
  const scope = getWalletNavigationScope();
  expect(await previewSpeedUpTransaction(ORIGINAL, false, 5700, ACCOUNT)).toBe(
    FEE
  );
  await submit(scope);
  expect(messages.map(route)).toEqual([originalRoute, originalRoute]);
  expect(messages[1].data.params[2]).toEqual({ approvedMaximumFee: FEE });
  expect(alert.error).toHaveBeenCalledWith(
    'transactions.speedUpAmountWouldChange'
  );
  expect(alert.error).not.toHaveBeenCalledWith(
    'transactions.transactionSpeedUpFailed'
  );
  expect(alert.warning).not.toHaveBeenCalled();
  expect(alert.success).not.toHaveBeenCalled();
});

it('does not show amount guidance after the wallet scope changes', async () => {
  let complete!: (value: unknown) => void;
  reply = (message, callback) => {
    expect(route(message)).toBe(originalRoute);
    complete = callback;
  };
  const scope = getWalletNavigationScope();
  const pending = submit(scope);
  mockVault.activeNetwork.url = 'https://other-rpc.synthetic.invalid';
  complete(rejection);
  await pending;
  expect(messages.map(route)).toEqual([originalRoute]);
  expect(alert.error).not.toHaveBeenCalled();
  expect(alert.warning).not.toHaveBeenCalled();
  expect(alert.success).not.toHaveBeenCalled();
});

it('keeps a successful quote, replacement result and metadata handoff as a healthy control', async () => {
  reply = (message, callback) => {
    const method = route(message);
    if (method === originalRoute)
      return callback(
        message.data.params[2].previewOnly
          ? quote
          : {
              isSpeedUp: true,
              error: false,
              transaction: { hash: REPLACEMENT },
            }
      );
    if (method === 'wallet.setEvmTransactionAsAccelerated')
      return callback({ hash: REPLACEMENT });
    throw new Error('Unexpected controller method');
  };
  const scope = getWalletNavigationScope();
  expect(await previewSpeedUpTransaction(ORIGINAL, false, 5700, ACCOUNT)).toBe(
    FEE
  );
  await submit(scope);
  expect(messages.map(route)).toEqual([
    originalRoute,
    originalRoute,
    'wallet.setEvmTransactionAsAccelerated',
  ]);
  expect(alert.success).toHaveBeenCalledWith(
    'transactions.transactionAcceleratedSuccessfully'
  );
  expect(alert.error).not.toHaveBeenCalled();
  expect(alert.warning).not.toHaveBeenCalled();
});

it('confirms the real transport preserves the structured rejection object', async () => {
  reply = (message, callback) => {
    expect(route(message)).toBe(originalRoute);
    callback(rejection);
  };
  await expect(
    controllerEmitter(
      ['wallet', 'ethereumTransaction', 'sendTransactionWithEditedFee'],
      [ORIGINAL, false, { approvedMaximumFee: FEE }]
    )
  ).rejects.toEqual(rejection);
  expect(messages.map(route)).toEqual([originalRoute]);
});

it('keeps unrelated transport errors on the existing generic feedback path', async () => {
  reply = (message, callback) => {
    expect(route(message)).toBe(originalRoute);
    callback({ error: true, code: 'SYNTHETIC_OTHER_FAILURE' });
  };
  await submit(getWalletNavigationScope());
  expect(alert.error).toHaveBeenCalledWith(
    'transactions.transactionSpeedUpFailed'
  );
  expect(alert.error).not.toHaveBeenCalledWith(
    'transactions.speedUpAmountWouldChange'
  );
});
