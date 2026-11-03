import { BigNumber } from '@sidhujag/sysweb3-keyring/cjs/ethers-v6';
import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum';
import { sendLocalEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer';
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
// MainController construction and live provider creation are forbidden. The
// actual installed EthereumTransactions class above is not mocked.
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(() => {
    throw new Error('REAL_KEYRING_CONSTRUCTION_FORBIDDEN');
  }),
  CustomJsonRpcProvider: jest.fn(() => {
    throw new Error('REAL_PROVIDER_CONSTRUCTION_FORBIDDEN');
  }),
  PsbtUtils: {},
}));
jest.mock(
  '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer',
  () => ({
    ...jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer'
    ),
    sendLocalEvmTransaction: jest.fn(),
  })
);
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));

// Precomputed public SDK test vector. Parsing authenticates fixture identity;
// no test generates a signature or possesses usable wallet credentials.
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
  signature: SIGNED.signature,
  gasPrice: BigNumber.from(SIGNED.gasPrice!),
  gasLimit: BigNumber.from(SIGNED.gasLimit),
  value: BigNumber.from(SIGNED.value),
  blockNumber: null,
  blockHash: null,
  ...fields,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};

describe('Pali cancellation through the manifest-pinned installed SDK', () => {
  let wallet: any;
  let sdk: EthereumTransactions;
  let keyring: any;
  let provider: any;
  let readVault: () => any;
  let syntheticCredential: jest.Mock;
  let networkDenied: jest.Mock;
  let hardwareDenied: jest.Mock;
  const rows = () =>
    mockState.vault.accountTransactions[mockState.vault.activeAccount.type][
      mockState.vault.activeAccount.id
    ].ethereum[CHAIN];
  const run = () =>
    wallet.cancelEvmTransaction(
      HASH,
      true,
      NONCE,
      PAYER,
      {
        chainId: CHAIN,
        walletScope: getWalletNavigationScope(),
      },
      { approvedMaximumFee: '999999999999999999999999' }
    );
  const unsignedRequest = () =>
    jest.mocked(sendLocalEvmTransaction).mock.calls[0]?.[2];

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
    readVault = () => mockState.vault;
    networkDenied = jest.fn(() => {
      throw new Error('NETWORK_FORBIDDEN');
    });
    hardwareDenied = jest.fn(() => {
      throw new Error('HARDWARE_FORBIDDEN');
    });
    jest.spyOn(global, 'fetch').mockImplementation(networkDenied);
    provider = {
      getTransaction: jest.fn().mockResolvedValue(original()),
      getGasPrice: jest.fn().mockResolvedValue(BigNumber.from(1)),
      send: networkDenied,
      sendTransaction: networkDenied,
      broadcastTransaction: networkDenied,
    };
    // This dependency-injected getter contains no key access. Its non-key
    // placeholder can reach only the denied unsigned signing boundary below.
    syntheticCredential = jest.fn(() => ({
      address: PAYER,
      decryptedPrivateKey: 'not-a-private-key',
    }));
    sdk = new EthereumTransactions(
      () => readVault().activeNetwork,
      syntheticCredential,
      () => ({
        activeAccountType: readVault().activeAccount.type,
        activeAccountId: readVault().activeAccount.id,
        accounts: readVault().accounts,
        activeNetwork: readVault().activeNetwork,
      }),
      { evm: { signEVMTransaction: hardwareDenied } } as any,
      { signEthTransaction: hardwareDenied } as any
    );
    Object.defineProperty(sdk, 'web3Provider', {
      configurable: true,
      get: () => provider,
    });
    jest.mocked(sendLocalEvmTransaction).mockImplementation(() => {
      throw new Error('UNSIGNED_BOUNDARY_HARD_STOP');
    });
    keyring = {
      ethereumTransaction: sdk,
      setVaultStateGetter: jest.fn((getter) => {
        readVault = getter;
      }),
    };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 5;
    wallet.isCreatingWallet = false;
    wallet.isResettingWallet = false;
    wallet.recoveryJournalPending = false;
    wallet.getActiveKeyring = jest.fn(() => keyring);
  });

  afterEach(() => {
    expect(networkDenied).not.toHaveBeenCalled();
    expect(hardwareDenied).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('uses the manifest-pinned package and an unmocked cancellation method', () => {
    const installed = jest.requireActual(
      '@sidhujag/sysweb3-keyring/package.json'
    );
    const manifest = jest.requireActual('../../../../package.json');
    expect(installed.version).toBe(
      manifest.dependencies['@sidhujag/sysweb3-keyring']
    );
    expect(jest.isMockFunction(sdk.cancelSentTransaction)).toBe(false);
  });

  it('admits a matching authenticated lookup only to the denied unsigned boundary', async () => {
    await expect(run()).resolves.toEqual({ isCanceled: false, error: true });
    expect(provider.getTransaction).toHaveBeenCalledWith(HASH);
    expect(syntheticCredential).toHaveBeenCalledTimes(1);
    expect(sendLocalEvmTransaction).toHaveBeenCalledTimes(1);
    expect(unsignedRequest()).toMatchObject({
      nonce: NONCE,
      from: PAYER,
      to: PAYER,
      type: 0,
    });
    expect(unsignedRequest().value.toString()).toBe('0');
  });

  it.each([
    ['hash', { hash: `0x${'88'.repeat(32)}` }],
    ['sender', { from: SMART }],
    ['chain', { chainId: CHAIN + 1 }],
    ['nonce', { nonce: NONCE + 1 }],
  ])(
    'rejects the SDK lookup with altered %s before fees or credentials',
    async (_label, fields) => {
      provider.getTransaction.mockResolvedValue(original(fields));
      await expect(run()).rejects.toThrow();
      expect(provider.getGasPrice).not.toHaveBeenCalled();
      expect(syntheticCredential).not.toHaveBeenCalled();
      expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
    }
  );

  it('rejects a null lookup when local history contains only an unsigned explorer nonce', async () => {
    rows()[0] = {
      hash: HASH,
      from: PAYER,
      nonce: NONCE,
      chainId: CHAIN,
      type: 0,
      historySource: 'explorer-pendingtxlist',
    };
    provider.getTransaction.mockResolvedValue(null);
    await expect(run()).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    expect(provider.getGasPrice).not.toHaveBeenCalled();
    expect(syntheticCredential).not.toHaveBeenCalled();
    expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
  });

  it.each(['raw', 'signed fields'])(
    'admits a null lookup only with matching cached %s',
    async (kind) => {
      rows()[0] = kind === 'raw' ? original({ raw: RAW }) : original();
      provider.getTransaction.mockResolvedValue(null);
      await expect(run()).resolves.toEqual({ isCanceled: false, error: true });
      expect(unsignedRequest()).toMatchObject({
        nonce: NONCE,
        from: PAYER,
        to: PAYER,
      });
      expect(sendLocalEvmTransaction).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['confirmed', 'replaced', 'missing', 'nonce', 'sender', 'chain'])(
    'rejects history becoming %s during the actual SDK fee await',
    async (change) => {
      const started = deferred<void>();
      const fee = deferred<BigNumber>();
      provider.getGasPrice.mockImplementation(() => {
        started.resolve();
        return fee.promise;
      });
      const pending = run();
      const rejected = expect(pending).rejects.toThrow(
        'PALI_TRANSACTION_CONTEXT_CHANGED'
      );
      await started.promise;
      if (change === 'confirmed') rows()[0].blockNumber = 42;
      if (change === 'replaced') rows()[0].isReplaced = true;
      if (change === 'missing') rows().splice(0);
      if (change === 'nonce') rows()[0].nonce += 1;
      if (change === 'sender') rows()[0].from = SMART;
      if (change === 'chain') rows()[0].chainId += 1;
      fee.resolve(BigNumber.from(1));
      await rejected;
      expect(syntheticCredential).not.toHaveBeenCalled();
      expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
    }
  );

  it('retains the authenticated nonce if the original RPC object changes during fees', async () => {
    const rpc = original();
    provider.getTransaction.mockResolvedValue(rpc);
    provider.getGasPrice.mockImplementation(async () => {
      rpc.nonce += 19;
      return BigNumber.from(1);
    });
    await expect(run()).resolves.toEqual({ isCanceled: false, error: true });
    expect(unsignedRequest().nonce).toBe(NONCE);
  });

  it('selects and restores the real outer payer for a smart-account row', async () => {
    mockState.vault.activeAccount = {
      type: KeyringAccountType.SmartAccount,
      id: 1,
    };
    syntheticCredential.mockImplementation((target) => {
      expect(target).toEqual({ type: KeyringAccountType.HDAccount, id: 0 });
      expect(readVault().activeAccount).toEqual({
        type: KeyringAccountType.SmartAccount,
        id: 1,
      });
      return { address: PAYER, decryptedPrivateKey: 'not-a-private-key' };
    });
    await expect(run()).resolves.toEqual({ isCanceled: false, error: true });
    expect(unsignedRequest().from).toBe(PAYER);
    expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
    expect(readVault()).toBe(mockState.vault);
    expect(mockState.vault.activeAccount).toEqual({
      type: KeyringAccountType.SmartAccount,
      id: 1,
    });
  });

  it.each(['resolve', 'reject'])(
    'the installed SDK declines an async validator before its delayed %s',
    async (outcome) => {
      const held = deferred<void>();
      const validation = (async () => {
        await held.promise;
        if (outcome === 'reject')
          throw new Error('Delayed validation rejection');
      })();
      const then = jest.spyOn(validation, 'then');
      try {
        await expect(
          sdk.cancelSentTransaction(HASH, true, NONCE, {
            assertCurrentContext: () => undefined,
            validateOriginal: () => validation,
            approvedMaximumFee: '999999999999999999999999',
          })
        ).rejects.toThrow('Original transaction validator must be synchronous');
        expect(then).toHaveBeenCalled();
        expect(provider.getGasPrice).not.toHaveBeenCalled();
        expect(syntheticCredential).not.toHaveBeenCalled();
        expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
      } finally {
        if (then.mock.calls.length === 0) validation.catch(() => undefined);
        held.resolve();
        await held.promise;
        await Promise.resolve();
      }
    }
  );
});
