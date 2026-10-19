/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createRequire } from 'module';
import React from 'react';

import Decrypt from 'pages/Transactions/Decrypt';
import EncryptPubKey from 'pages/Transactions/EncryptPubKey';
import DAppController from 'scripts/Background/controllers/DAppController';
import MainController from 'scripts/Background/controllers/MainController';
import { onMessage } from 'scripts/Background/controllers/message-handler';
import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { MethodRoute } from 'scripts/Background/controllers/message-handler/types';
import { handleMasterControllerResponses } from 'scripts/Background/handlers/handleMasterControllerResponses';
import dappReducer from 'state/dapp';
import spamFilterReducer from 'state/spamFilter';
import vaultReducer from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

// Use the installed SDK's native nested dependency resolution. Jest's
// moduleDirectories override otherwise substitutes a different ECC dependency.
const sdkRequire = createRequire(
  require.resolve('@sidhujag/sysweb3-keyring/package.json')
);
const { EthereumTransactions } = sdkRequire('./cjs/transactions/ethereum');
const { encrypt, getEncryptionPublicKey } = sdkRequire(
  '@metamask/eth-sig-util'
);

let mockState: any;
let mockQuery: any;
let mockController: any;
let mockPopupResolve: (value: any) => void;
let mockInternalListener: any;
let mockEmitter: any;
const mockEvents: any[] = [];
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => {
      mockState = {
        ...mockState,
        vault: vaultReducer(mockState.vault, action),
        vaultGlobal: vaultGlobalReducer(mockState.vaultGlobal, action),
        dapp: dappReducer(mockState.dapp, action),
      };
    },
  },
  saveMainState: jest.fn(async () => true),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('scripts/Background', () => ({
  getController: () => mockController,
  notificationManager: { notifyAccountChange: jest.fn() },
}));
// The main SDK entry point initializes unrelated hardware integrations. The
// encryption transaction implementation above is imported directly and real.
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
// This EVM-only test never invokes the unrelated UTXO builder.
jest.mock('syscointx-js', () => ({ bufferUtils: {} }));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({ alert: { info: jest.fn(), error: jest.fn() } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  LockFilled: () => null,
  LockIconSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, loading, disabled, ...props }: any) => (
    <button disabled={loading || disabled} {...props}>
      {children}
    </button>
  ),
  Icon: () => null,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Tooltip: ({ children }: any) => children,
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/index'),
  ellipsis: (value: string) => value,
}));
jest.mock('utils/browser', () => ({
  dispatchBackgroundEvent: (name: string, value: any) => {
    mockEvents.push({ name, value });
    mockPopupResolve(value);
  },
}));
jest.mock(
  'scripts/Background/controllers/message-handler/popup-promise',
  () => ({
    popupPromise: jest.fn(),
  })
);
jest.mock('scripts/Provider/EthProvider', () => ({ EthProvider: jest.fn() }));
jest.mock('scripts/Provider/SysProvider', () => ({ SysProvider: jest.fn() }));

const HOST = 'https://encryption.invalid';
// Public disposable fixture scalar. No wallet/profile/keychain data is read.
const PRIVATE_KEY = '11'.repeat(32);
const OTHER_PRIVATE_KEY = '22'.repeat(32);
const ADDRESS = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
const OTHER_OWNED = '0x1563915e194D8CfBA1943570603F7606A3115508';
const FOREIGN = `0x${'33'.repeat(20)}`;
const PLAINTEXT = 'Public synthetic plaintext: receiver binding control';
let publicKey: string;
let ciphertext: string;
let sdk: InstanceType<typeof EthereumTransactions>;
const network = {
  kind: INetworkType.Ethereum,
  chainId: 1,
  slip44: 60,
  url: 'https://rpc.invalid',
};
const request = (method: string, params: any) =>
  onMessage({ type: 'METHOD_REQUEST', data: { method, params } }, {
    url: `${HOST}/request`,
    tab: { id: 71 },
  } as any);
const encryptedFor = (key = PRIVATE_KEY) =>
  '0x' +
  Buffer.from(
    JSON.stringify(
      encrypt({
        publicKey: getEncryptionPublicKey(key),
        data: PLAINTEXT,
        version: 'x25519-xsalsa20-poly1305',
      })
    ),
    'utf8'
  ).toString('hex');

beforeEach(() => {
  // Node Buffer belongs to the host realm. TweetNaCl checks instanceof against
  // Uint8Array, so keep the JSDOM test's byte-array realm aligned with Buffer.
  global.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;
  publicKey = getEncryptionPublicKey(PRIVATE_KEY);
  jest.clearAllMocks();
  mockEvents.length = 0;
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(window, 'close').mockImplementation();
  const vault = vaultReducer(undefined, { type: 'test/init' });
  mockState = {
    vault: {
      ...vault,
      isBitcoinBased: false,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      accounts: {
        ...vault.accounts,
        HDAccount: {
          0: { id: 0, label: 'Connected account A', address: ADDRESS },
          1: {
            id: 1,
            label: 'Different wallet account B',
            address: OTHER_OWNED,
          },
        },
      },
      activeNetwork: network,
    },
    vaultGlobal: {
      ...vaultGlobalReducer(undefined, { type: 'test/init' }),
      networkStatus: 'idle',
      activeSlip44: 60,
    },
    dapp: {
      dapps: {
        [HOST]: {
          host: HOST,
          accountId: 0,
          accountType: KeyringAccountType.HDAccount,
          chain: INetworkType.Ethereum,
          chainId: 1,
          date: 1,
        },
      },
    },
    spamFilter: spamFilterReducer(undefined, { type: 'test/init' }),
  };
  sdk = new EthereumTransactions(
    () => mockState.vault.activeNetwork,
    () => {
      const id = mockState.vault.activeAccount.id;
      return {
        address: mockState.vault.accounts.HDAccount[id].address,
        decryptedPrivateKey: id === 0 ? PRIVATE_KEY : OTHER_PRIVATE_KEY,
      };
    },
    () => ({
      ...mockState.vault,
      activeAccountType: 'HDAccount',
      activeAccountId: mockState.vault.activeAccount.id,
    }),
    {} as any,
    {} as any
  );
  const wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletSessionGeneration: 7,
    assetUpdateRequestId: 0,
    stopAllRapidPolling: jest.fn(),
    cancelActiveBalanceUpdate: jest.fn(),
    cancellablePromises: {},
    saveWalletState: jest.fn().mockResolvedValue(undefined),
    resetAutoLockTimer: jest.fn(),
    performPostAccountSwitchOperations: jest.fn().mockResolvedValue(undefined),
    isUnlocked: () => true,
    getWalletSetupStatus: () => false,
  });
  Object.defineProperty(wallet, 'ethereumTransaction', { value: sdk });
  // The real constructor binds public methods before message dispatch.
  wallet.getEncryptionPublicKeyForAccount =
    wallet.getEncryptionPublicKeyForAccount.bind(wallet);
  mockController = { wallet, dapp: DAppController(() => true) };
  Object.assign(chrome.runtime, {
    id: 'synthetic-pali',
    getURL: (path: string) => `chrome-extension://synthetic-pali/${path}`,
    onMessage: {
      addListener: (listener: any) => {
        mockInternalListener = listener;
      },
      removeListener: jest.fn(),
    },
  });
  Object.assign(chrome, {
    tabs: {
      query: jest.fn((_query, reply) => reply([])),
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    },
    scripting: { executeScript: jest.fn(async () => []) },
  });
  handleMasterControllerResponses(mockController);
  mockEmitter = jest.fn(
    (methods: string[], params: any[] = []) =>
      new Promise((resolve, reject) => {
        mockInternalListener(
          { type: 'CONTROLLER_ACTION', data: { methods, params } },
          {
            id: 'synthetic-pali',
            url: 'chrome-extension://synthetic-pali/external.html',
            frameId: 0,
            documentId: 'synthetic-approval-document',
          },
          (value: any) =>
            value?.success === false
              ? reject(new Error(value.error))
              : resolve(value)
        );
      })
  );
  ciphertext = encryptedFor();
  jest.mocked(popupPromise).mockImplementation((popup) => {
    mockQuery = { ...popup.data, host: popup.host, eventName: popup.eventName };
    return new Promise((resolve) => {
      mockPopupResolve = resolve;
      render(
        popup.route === MethodRoute.EncryptKey ? <EncryptPubKey /> : <Decrypt />
      );
    });
  });
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function approve(method: string, params: any[]) {
  const pending = request(method, params);
  const confirm = await Promise.race([
    screen.findByRole('button', { name: 'buttons.confirm' }),
    pending.then((result) => {
      throw new Error(`Request ended before popup: ${JSON.stringify(result)}`);
    }),
  ]);
  await act(async () => {
    fireEvent.click(confirm);
  });
  return pending;
}

it('healthy: the actual SDK returns A encryption key when A is requested', async () => {
  await expect(approve('eth_getEncryptionPublicKey', [ADDRESS])).resolves.toBe(
    publicKey
  );
  expect(popupPromise).toHaveBeenCalledTimes(1);
});

it('healthy: the actual SDK decrypts A ciphertext when A is requested', async () => {
  await expect(approve('eth_decrypt', [ciphertext, ADDRESS])).resolves.toBe(
    PLAINTEXT
  );
  expect(popupPromise).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'binds delayed public-key retrieval to its requested account (switch=%s)',
  async (switchAccount) => {
    mockQuery = {
      host: HOST,
      eventName: 'eth_getEncryptionPublicKey',
      0: ADDRESS,
    };
    mockPopupResolve = jest.fn();
    const execute = mockEmitter.getMockImplementation();
    const getKey = jest.spyOn(sdk, 'getEncryptedPubKey');
    let release!: () => void;
    const heldMessage = new Promise<void>((resolve) => (release = resolve));
    mockEmitter.mockImplementation((...args: any[]) =>
      heldMessage.then(() => execute(...args))
    );
    render(<EncryptPubKey />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(getKey).not.toHaveBeenCalled();
    if (switchAccount)
      await act(async () => {
        await mockController.wallet.setAccount(
          1,
          KeyringAccountType.HDAccount,
          true,
          OTHER_OWNED
        );
      });
    await act(async () => release());
    if (switchAccount) {
      await screen.findByText('Requested account is not active');
      expect(getKey).not.toHaveBeenCalled();
      expect(mockEvents).toEqual([]);
    } else {
      await waitFor(() =>
        expect(mockEvents).toEqual([
          { name: `eth_getEncryptionPublicKey.${HOST}`, value: publicKey },
        ])
      );
      expect(getKey).toHaveBeenCalledTimes(1);
    }
  }
);

describe.each(['eth_getEncryptionPublicKey', 'eth_decrypt'])(
  '%s requested-account admission',
  (method) => {
    const paramsFor = (target: string) =>
      method === 'eth_decrypt'
        ? [encryptedFor(OTHER_PRIVATE_KEY), target]
        : [target];

    it('awaits explicit selection before operating on another owned account', async () => {
      let accept!: () => void;
      const selection = new Promise<void>((resolve) => {
        accept = resolve;
      });
      jest.mocked(popupPromise).mockImplementationOnce(async (popup) => {
        expect(popup.route).toBe(MethodRoute.ChangeActiveConnectedAccount);
        expect(popup.data).toMatchObject({
          connectedAccount: { address: OTHER_OWNED, id: 1 },
          accountType: KeyringAccountType.HDAccount,
        });
        await selection;
        await mockController.wallet.setAccount(
          1,
          KeyringAccountType.HDAccount,
          true,
          OTHER_OWNED
        );
        return null;
      });
      const approval = approve(method, paramsFor(OTHER_OWNED));
      await waitFor(() => expect(popupPromise).toHaveBeenCalledTimes(1));
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(mockState.vault.activeAccount.id).toBe(0);
      accept();
      await expect(approval).resolves.toBe(
        method === 'eth_decrypt'
          ? PLAINTEXT
          : getEncryptionPublicKey(OTHER_PRIVATE_KEY)
      );
      expect(popupPromise).toHaveBeenCalledTimes(2);
      expect(mockState.vault.activeAccount.id).toBe(1);
      expect(mockController.dapp.getAccount(HOST).address).toBe(OTHER_OWNED);
      expect(mockController.wallet.saveWalletState).toHaveBeenCalledWith(
        'account-switch',
        true,
        true
      );
    });

    it('does not open encryption consent after a rejected account switch', async () => {
      jest
        .mocked(popupPromise)
        .mockRejectedValueOnce(new Error('User rejected'));
      await expect(
        request(method, paramsFor(OTHER_OWNED))
      ).resolves.toMatchObject({ error: { code: 4100 } });
      expect(popupPromise).toHaveBeenCalledTimes(1);
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(mockState.vault.activeAccount.id).toBe(0);
      expect(mockController.dapp.getAccount(HOST).address).toBe(ADDRESS);
    });

    it('rejects an unknown account before opening any consent or touching keys', async () => {
      await expect(request(method, paramsFor(FOREIGN))).resolves.toMatchObject({
        error: { code: 4100 },
      });
      expect(popupPromise).not.toHaveBeenCalled();
      expect(mockEmitter).not.toHaveBeenCalled();
    });

    it.each(
      [undefined, [], ['invalid'], [123], [ADDRESS, ADDRESS, ADDRESS]].map(
        (params) => ({ params })
      )
    )(
      'rejects malformed params %# before opening encryption consent',
      async ({ params }) => {
        await expect(request(method, params)).resolves.toMatchObject({
          error: { code: -32602 },
        });
        expect(popupPromise).not.toHaveBeenCalled();
        expect(mockEmitter).not.toHaveBeenCalled();
      }
    );
  }
);

it('preserves a case-insensitive requested receiver all the way into the actual SDK', async () => {
  await expect(
    approve('eth_decrypt', [ciphertext, ADDRESS.toLowerCase()])
  ).resolves.toBe(PLAINTEXT);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'ethereumTransaction', 'decryptMessage'],
    [[ciphertext, ADDRESS.toLowerCase()]]
  );
});

it('refuses a wrong receiver even when the decryption popup is opened directly', async () => {
  expect(() => sdk.decryptMessage([ciphertext, FOREIGN])).toThrow(
    'Decrypting for wrong receiver'
  );
  mockQuery = {
    host: HOST,
    eventName: 'eth_decrypt',
    0: ciphertext,
    1: FOREIGN,
  };
  render(<Decrypt />);
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'transactions.decryptMessage' })
    );
  });
  expect(screen.getByText('Requested account is not active')).toBeDefined();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  });
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockEvents).toEqual([]);
});

it('refuses a different requested account in a directly opened public-key popup', async () => {
  mockQuery = {
    host: HOST,
    eventName: 'eth_getEncryptionPublicKey',
    0: OTHER_OWNED,
  };
  render(<EncryptPubKey />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  });
  expect(screen.getByText('Requested account is not active')).toBeDefined();
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockEvents).toEqual([]);
});

it('invalidates a decrypted preview when only its requested receiver changes', async () => {
  mockQuery = {
    host: HOST,
    eventName: 'eth_decrypt',
    0: ciphertext,
    1: ADDRESS,
  };
  const view = render(<Decrypt />);
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'transactions.decryptMessage' })
    );
  });
  expect(screen.getByText(PLAINTEXT)).toBeDefined();
  mockQuery = { ...mockQuery, 1: OTHER_OWNED };
  view.rerender(<Decrypt />);
  expect(screen.queryByText(PLAINTEXT)).toBeNull();
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'transactions.decryptMessage' })
    );
  });
  expect(screen.getByText('Requested account is not active')).toBeDefined();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEvents).toEqual([]);
});
