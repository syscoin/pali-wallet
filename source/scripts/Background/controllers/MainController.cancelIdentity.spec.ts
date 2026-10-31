import { Transaction } from 'ethers/transaction';

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
  PsbtUtils: {},
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));

// Existing public SDK vector. No signing, hardware or RPC is used by this suite.
const RAW =
  '0xf865018504a817c800825208942c7536e3605d9c16a7a3d7b1898e529396a65c2301808196a09e45c98f8c125ec111da1ee78c493e4a81c6f395001db83c8d12e15a86bb6699a0395567d28d51d925f906ff930731a589c78138326bcce5687ce2b1697176ae9e';
const SIGNED = Transaction.from(RAW);
const PAYER = SIGNED.from!;
const HASH = SIGNED.hash!;
const CHAIN = Number(SIGNED.chainId);
const NONCE = SIGNED.nonce;
const SMART = `0x${'55'.repeat(20)}`;
let mockState: any;
const original = (fields: any = {}) => ({
  ...SIGNED.toJSON(),
  hash: HASH,
  from: PAYER,
  nonce: NONCE,
  chainId: CHAIN,
  blockNumber: null,
  blockHash: null,
  ...fields,
});

describe('cancellation reviewed original admission', () => {
  let wallet: any;
  let cancel: jest.Mock;
  let admitted: jest.Mock;
  let keyring: any;
  const rows = () =>
    mockState.vault.accountTransactions[mockState.vault.activeAccount.type][
      mockState.vault.activeAccount.id
    ].ethereum[CHAIN];
  const run = (nonce: any = NONCE, signer = PAYER) =>
    wallet.cancelEvmTransaction(HASH, true, nonce, signer, {
      chainId: CHAIN,
      walletScope: getWalletNavigationScope(),
    });
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      vault: {
        isBitcoinBased: false,
        activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
        activeNetwork: {
          kind: 'ethereum',
          chainId: CHAIN,
          slip44: 60,
          url: 'https://synthetic.invalid',
        },
        accounts: {
          HDAccount: { 0: { address: PAYER, xpub: 'synthetic-public' } },
          SmartAccount: {
            1: { address: SMART, smartAccount: { chainId: CHAIN } },
          },
        },
        accountTransactions: {
          HDAccount: { 0: { ethereum: { [CHAIN]: [original()] } } },
          SmartAccount: {
            1: {
              ethereum: {
                [CHAIN]: [original({ smartAccountExecutionFrom: SMART })],
              },
            },
          },
        },
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    admitted = jest.fn();
    // The SDK's signature authentication is tested in its own package. This
    // mock explicitly implements its new host-validation contract.
    cancel = jest.fn(async (_hash, _legacy, nonce, options) => {
      options.assertCurrentContext();
      options.validateOriginal(original());
      await Promise.resolve();
      options.assertCurrentContext();
      admitted(nonce);
      return {
        isCanceled: true,
        transaction: { hash: `0x${'99'.repeat(32)}` },
      };
    });
    keyring = {
      ethereumTransaction: { web3Provider: {}, cancelSentTransaction: cancel },
      setVaultStateGetter: jest.fn(),
    };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 5;
    wallet.isResettingWallet = false;
    wallet.isCreatingWallet = false;
    wallet.recoveryJournalPending = false;
    wallet.getActiveKeyring = jest.fn(() => keyring);
  });

  it('admits a matching authenticated lookup and passes both SDK guards', async () => {
    await expect(run()).resolves.toMatchObject({ isCanceled: true });
    expect(admitted).toHaveBeenCalledWith(NONCE);
    expect(cancel).toHaveBeenCalledWith(HASH, true, NONCE, {
      assertCurrentContext: expect.any(Function),
      validateOriginal: expect.any(Function),
      targetAccount: undefined,
      previewOnly: false,
      approvedMaximumFee: undefined,
    });
  });

  it.each([
    ['missing', null],
    ['nonce', { nonce: NONCE + 1 }],
    ['sender', { from: SMART }],
    ['chain', { chainId: CHAIN + 1 }],
    ['confirmed', { blockNumber: 42 }],
    ['replaced', { isReplaced: true }],
    ['replacement status', { status: 'replaced' }],
    ['token placeholder', { historySource: 'explorer-tokentx' }],
  ])(
    'rejects stale or ineligible %s history before SDK access',
    async (_label, fields) => {
      rows().splice(0, 1, ...(fields ? [original(fields)] : []));
      await expect(run()).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
      expect(cancel).not.toHaveBeenCalled();
      expect(admitted).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, null, -1, NONCE + 1, 1.5, '1'])(
    'rejects unreviewed nonce %p instead of adopting current history',
    async (nonce) => {
      await expect(
        wallet.cancelEvmTransaction(HASH, true, nonce, PAYER, {
          chainId: CHAIN,
          walletScope: getWalletNavigationScope(),
        })
      ).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
      expect(cancel).not.toHaveBeenCalled();
    }
  );

  it.each(['confirmed', 'replaced', 'missing', 'nonce', 'sender', 'chain'])(
    'stops admission if history becomes %s during the SDK fee await',
    async (change) => {
      cancel.mockImplementation(async (_hash, _legacy, nonce, options) => {
        options.validateOriginal(original());
        await Promise.resolve();
        if (change === 'confirmed') rows()[0].blockNumber = 42;
        if (change === 'replaced') rows()[0].isReplaced = true;
        if (change === 'missing') rows().splice(0);
        if (change === 'nonce') rows()[0].nonce++;
        if (change === 'sender') rows()[0].from = SMART;
        if (change === 'chain') rows()[0].chainId++;
        options.assertCurrentContext();
        admitted(nonce);
      });
      await expect(run()).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
      expect(admitted).not.toHaveBeenCalled();
    }
  );

  it.each([
    { hash: `0x${'88'.repeat(32)}` },
    { from: SMART },
    { nonce: NONCE + 1 },
    { chainId: CHAIN + 1 },
    { blockNumber: 42 },
  ])(
    'rejects an SDK callback that does not match reviewed identity %j',
    async (fields) => {
      cancel.mockImplementation(async (_hash, _legacy, nonce, options) => {
        options.validateOriginal(original(fields));
        admitted(nonce);
      });
      await expect(run()).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
      expect(admitted).not.toHaveBeenCalled();
    }
  );

  it('rejects null lookup for unsigned explorer-only history', async () => {
    rows()[0] = {
      hash: HASH,
      from: PAYER,
      nonce: NONCE,
      chainId: CHAIN,
      type: 0,
      historySource: 'explorer-pendingtxlist',
    };
    cancel.mockImplementation(async (_hash, _legacy, nonce, options) => {
      options.validateOriginal(null);
      admitted(nonce);
    });
    await expect(run()).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    expect(admitted).not.toHaveBeenCalled();
  });

  it.each(['raw', 'signed fields'])(
    'admits null only for a matching cached %s original',
    async (kind) => {
      rows()[0] =
        kind === 'raw'
          ? original({ raw: RAW })
          : original({ signature: SIGNED.signature });
      cancel.mockImplementation(async (_hash, _legacy, nonce, options) => {
        options.validateOriginal(null);
        options.assertCurrentContext();
        admitted(nonce);
        return { isCanceled: true };
      });
      await expect(run()).resolves.toMatchObject({ isCanceled: true });
      expect(admitted).toHaveBeenCalledWith(NONCE);
    }
  );

  it('rejects cached fallback fields that do not match their signed hash', async () => {
    rows()[0] = original({ signature: SIGNED.signature, to: SMART });
    cancel.mockImplementation(async (_hash, _legacy, nonce, options) => {
      options.validateOriginal(null);
      admitted(nonce);
    });
    await expect(run()).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    expect(admitted).not.toHaveBeenCalled();
  });

  it('stops a trusted fallback if its cached signed evidence disappears during the fee await', async () => {
    rows()[0] = original({ raw: RAW });
    cancel.mockImplementation(async (_hash, _legacy, nonce, options) => {
      options.validateOriginal(null);
      await Promise.resolve();
      rows()[0] = {
        hash: HASH,
        from: PAYER,
        nonce: NONCE,
        chainId: CHAIN,
        type: 0,
      };
      options.assertCurrentContext();
      admitted(nonce);
    });
    await expect(run()).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    expect(admitted).not.toHaveBeenCalled();
  });

  it('rejects a stale pending row when another hash has consumed the same outer nonce', async () => {
    rows().push(original({ hash: `0x${'88'.repeat(32)}`, blockNumber: 42 }));
    await expect(run()).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('binds the smart-account row to its actual outer payer', async () => {
    mockState.vault.activeAccount = {
      type: KeyringAccountType.SmartAccount,
      id: 1,
    };
    await expect(run()).resolves.toMatchObject({ isCanceled: true });
    expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
    expect(cancel.mock.calls[0][3].targetAccount).toEqual({
      type: KeyringAccountType.HDAccount,
      id: 0,
    });
    expect(admitted).toHaveBeenCalledWith(NONCE);
  });
});
