import { getController } from '..';
import { KeyringAccountType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';

import MainController from './MainController';

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
  PsbtUtils: { toPali: jest.fn((psbt) => psbt) },
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));

let mockState: any;
const PAYER = `0x${'11'.repeat(20)}`;
const SMART = `0x${'22'.repeat(20)}`;
const HASH = `0x${'33'.repeat(32)}`;
const CHAIN = 5700;

describe('cancellation controller account and network admission', () => {
  let wallet: any;
  let keyring: any;
  let readVault: () => any;
  let cancel: jest.Mock;
  const expected = () => ({
    chainId: CHAIN,
    walletScope: getWalletNavigationScope(),
  });
  const run = (context: any = expected(), signer = PAYER) =>
    wallet.cancelEvmTransaction(HASH, true, 7, signer, context);

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      vault: {
        isBitcoinBased: false,
        activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
        accounts: {
          HDAccount: { 0: { address: PAYER, xpub: 'payer public fixture' } },
          Imported: { 3: { address: `0x${'44'.repeat(20)}` } },
          SmartAccount: {
            1: { address: SMART, smartAccount: { chainId: CHAIN } },
          },
        },
        activeNetwork: {
          kind: 'ethereum',
          chainId: CHAIN,
          slip44: 60,
          url: 'https://rpc.invalid',
        },
        accountTransactions: {
          HDAccount: {
            0: {
              ethereum: {
                [CHAIN]: [
                  {
                    hash: HASH,
                    from: PAYER,
                    nonce: 7,
                    chainId: CHAIN,
                    type: 0,
                  },
                ],
              },
            },
          },
          SmartAccount: {
            1: {
              ethereum: {
                [CHAIN]: [
                  {
                    hash: HASH,
                    from: PAYER,
                    nonce: 7,
                    chainId: CHAIN,
                    type: 0,
                    smartAccountExecutionFrom: SMART,
                  },
                ],
              },
            },
          },
        },
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    readVault = () => mockState.vault;
    cancel = jest.fn(async (_hash, _legacy, _nonce, options) => {
      options.assertCurrentContext();
      options.validateOriginal({
        hash: HASH,
        from: PAYER,
        nonce: 7,
        chainId: CHAIN,
      });
      return { isCanceled: true, transaction: { hash: HASH } };
    });
    keyring = {
      setVaultStateGetter: jest.fn((getter) => (readVault = getter)),
      ethereumTransaction: { cancelSentTransaction: cancel, web3Provider: {} },
    };
    wallet = Object.create(MainController.prototype);
    wallet.isCreatingWallet = false;
    wallet.isResettingWallet = false;
    wallet.recoveryJournalPending = false;
    wallet.walletSessionGeneration = 5;
    wallet.getActiveKeyring = jest.fn(() => keyring);
    jest.mocked(getController).mockReturnValue({ wallet } as any);
  });

  it('admits current scope and passes the original nonce/fee inputs unchanged', async () => {
    await expect(run()).resolves.toMatchObject({ isCanceled: true });
    expect(cancel).toHaveBeenCalledWith(HASH, true, 7, {
      assertCurrentContext: expect.any(Function),
      validateOriginal: expect.any(Function),
    });
    expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
  });

  it('rejects direct callers without the required context', async () => {
    await expect(
      wallet.cancelEvmTransaction(HASH, true, 7, PAYER)
    ).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('compares signer addresses case-insensitively', async () => {
    mockState.vault.accounts.HDAccount[0].address = `0x${'ab'.repeat(20)}`;
    mockState.vault.accountTransactions.HDAccount[0].ethereum[
      CHAIN
    ][0].from = `0x${'ab'.repeat(20)}`;
    cancel.mockImplementation(async (_hash, _legacy, _nonce, options) => {
      options.assertCurrentContext();
      options.validateOriginal({
        hash: HASH,
        from: `0x${'AB'.repeat(20)}`,
        nonce: 7,
        chainId: CHAIN,
      });
      return { isCanceled: true };
    });
    await expect(
      run(expected(), `0x${'AB'.repeat(20)}`)
    ).resolves.toMatchObject({
      isCanceled: true,
    });
  });

  it.each([
    ['account', () => (mockState.vault.activeAccount.id = 2)],
    ['address', () => (mockState.vault.accounts.HDAccount[0].address = SMART)],
    ['xpub', () => (mockState.vault.accounts.HDAccount[0].xpub += '-changed')],
    ['chain', () => (mockState.vault.activeNetwork.chainId += 1)],
    ['RPC', () => (mockState.vault.activeNetwork.url += '/changed')],
    [
      'API endpoint',
      () => (mockState.vault.activeNetwork.apiUrl = 'https://api.invalid'),
    ],
    ['network kind', () => (mockState.vault.activeNetwork.kind = 'syscoin')],
    ['slip44', () => (mockState.vaultGlobal.activeSlip44 += 1)],
  ])(
    'rejects stale %s scope before SDK or signer access',
    async (_name, mutate: () => void) => {
      const context = expected();
      mutate();
      await expect(run(context)).rejects.toThrow(
        'PALI_TRANSACTION_CONTEXT_CHANGED'
      );
      expect(wallet.getActiveKeyring).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
      expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
    }
  );

  it.each([
    { chainId: CHAIN + 1, walletScope: {} },
    { chainId: CHAIN, walletScope: undefined },
    { chainId: CHAIN, walletScope: { account: 'old', network: 'old' } },
  ])('rejects mismatched or incomplete context %j', async (context) => {
    await expect(run(context)).rejects.toThrow(
      'PALI_TRANSACTION_CONTEXT_CHANGED'
    );
    expect(cancel).not.toHaveBeenCalled();
  });

  it('rejects an EOA signer mismatch under an otherwise current scope', async () => {
    await expect(
      wallet.cancelEvmTransaction(HASH, true, 7, SMART, expected())
    ).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', ' '])(
    'rejects absent signer identity %p',
    async (signer) => {
      await expect(
        wallet.cancelEvmTransaction(HASH, true, 7, signer, expected())
      ).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
      expect(cancel).not.toHaveBeenCalled();
    }
  );

  it('rejects UTXO scope before SDK access', async () => {
    mockState.vault.isBitcoinBased = true;
    await expect(run()).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'preserves smart-account outer payer and restores the getter (reject=%s)',
    async (reject) => {
      mockState.vault.activeAccount = {
        type: KeyringAccountType.SmartAccount,
        id: 1,
      };
      cancel.mockImplementation(async () => {
        expect(readVault().activeAccount).toEqual({
          type: KeyringAccountType.HDAccount,
          id: 0,
        });
        if (reject) throw new Error('Synthetic signer rejection');
        return { isCanceled: true };
      });
      if (reject)
        await expect(run()).rejects.toThrow('Synthetic signer rejection');
      else await expect(run()).resolves.toEqual({ isCanceled: true });
      expect(mockState.vault.activeAccount).toEqual({
        type: KeyringAccountType.SmartAccount,
        id: 1,
      });
      expect(readVault()).toBe(mockState.vault);
      expect(keyring.setVaultStateGetter).toHaveBeenCalledTimes(2);
    }
  );

  it('rejects a non-local smart-account payer instead of signing with its account', async () => {
    mockState.vault.activeAccount = {
      type: KeyringAccountType.SmartAccount,
      id: 1,
    };
    await expect(run(expected(), `0x${'99'.repeat(20)}`)).rejects.toThrow(
      'Unable to find local signer'
    );
    expect(cancel).not.toHaveBeenCalled();
    expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
  });

  it.each([
    'host account',
    'host network',
    'host address',
    'session',
    'setup',
    'keyring',
    'controller',
    'provider',
  ])(
    'guards pending smart-account cancellation against changed %s',
    async (change) => {
      mockState.vault.activeAccount = {
        type: KeyringAccountType.SmartAccount,
        id: 1,
      };
      let resume!: () => void;
      const held = new Promise<void>((resolve) => {
        resume = resolve;
      });
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      cancel.mockImplementation(async (_hash, _legacy, _nonce, options) => {
        expect(readVault().activeAccount).toEqual({
          type: KeyringAccountType.HDAccount,
          id: 0,
        });
        options.assertCurrentContext();
        entered();
        await held;
        // A temporary SDK gas-payer selection cannot hide the host selection.
        options.assertCurrentContext();
        return { isCanceled: true };
      });
      const pending = run();
      const rejected = expect(pending).rejects.toThrow();
      await started;
      if (change === 'host account')
        mockState.vault.activeAccount = {
          type: KeyringAccountType.HDAccount,
          id: 0,
        };
      if (change === 'host network')
        mockState.vault.activeNetwork.url += '/changed';
      if (change === 'host address')
        mockState.vault.accounts.SmartAccount[1].address = PAYER;
      if (change === 'session') wallet.walletSessionGeneration += 1;
      if (change === 'setup') wallet.isCreatingWallet = true;
      if (change === 'keyring') wallet.getActiveKeyring.mockReturnValue({});
      if (change === 'controller') keyring.ethereumTransaction = {};
      if (change === 'provider') keyring.ethereumTransaction.web3Provider = {};
      resume();
      await rejected;
      expect(readVault()).toBe(mockState.vault);
    }
  );
});
