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
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: unknown) => {
      mockStorage.set(key, value);
    }),
  },
}));
jest.mock('utils/slhDsa/offscreenClient', () => ({
  signSLHDSAInOffscreen: jest.fn(),
}));

import { KeyringAccountType } from 'types/network';
import {
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_SIGNATURE_LENGTH,
  clearRuntimeSLHDSAStates,
  createSLHDSAProvisionedState,
  getSLHDSAKeyId,
  getSLHDSAStateStorageKey,
  loadEncryptedSLHDSAState,
  putRuntimeSLHDSAState,
  saveEncryptedSLHDSAState,
} from 'utils/slhDsa';
import { signSLHDSAInOffscreen } from 'utils/slhDsa/offscreenClient';

import MainController from './MainController';

let mockState: any;
const mockStorage = new Map<string, unknown>();
const GUARDIAN_ID = 18;
const OTHER_ID = 31;
const VALIDATOR = `0x${'11'.repeat(20)}`;
const COMPOSITE = `0x${'aa'.repeat(20)}`;
const ACTION_HASH = `0x${'22'.repeat(32)}`;
const GUARDIAN_KEY = {
  pkRoot: `0x${'33'.repeat(16)}${'00'.repeat(16)}`,
  pkSeed: `0x${'44'.repeat(16)}${'00'.repeat(16)}`,
};
const OTHER_KEY = {
  pkRoot: `0x${'55'.repeat(16)}${'00'.repeat(16)}`,
  pkSeed: `0x${'66'.repeat(16)}${'00'.repeat(16)}`,
};
// Deliberately synthetic crypto/offscreen fixtures: these checks exercise
// controller account selection and durable counters, not SLH cryptography.
const stateCrypto = {
  encrypt: (plainText: string) => `unit-test-envelope:${plainText}`,
  decrypt: (cipherText: string) =>
    cipherText.slice('unit-test-envelope:'.length),
};
const SIGNATURE = `0x${'77'.repeat(SLH_DSA_SIGNATURE_LENGTH)}`;

const provisioned = (
  publicKey: typeof GUARDIAN_KEY,
  accountIndex: number,
  count: number
) => ({
  ...createSLHDSAProvisionedState({
    ...publicKey,
    accountIndex,
    derivationLabel: `unit-test-account/${accountIndex}`,
    keyId: getSLHDSAKeyId(publicKey),
    secretKeyHex: `0x${'88'.repeat(64)}`,
  }),
  signatureCount: count,
});

describe('non-active SLH smart guardian signer hydration', () => {
  let wallet: any;
  let keyring: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockStorage.clear();
    clearRuntimeSLHDSAStates();
    mockState = {
      vault: {
        activeAccount: { id: OTHER_ID, type: KeyringAccountType.SmartAccount },
        accounts: {
          [KeyringAccountType.SmartAccount]: {
            [GUARDIAN_ID]: {
              id: GUARDIAN_ID,
              isSmartAccount: true,
              smartAccount: {
                auth: { module: 'slh-dsa', validator: VALIDATOR },
                installedModules: [
                  {
                    address: VALIDATOR,
                    config: { keyId: getSLHDSAKeyId(GUARDIAN_KEY) },
                    id: 'slh-dsa',
                    type: 'validator',
                  },
                ],
              },
            },
            [OTHER_ID]: {
              id: OTHER_ID,
              isSmartAccount: true,
              smartAccount: { auth: { module: 'ecdsa', validator: VALIDATOR } },
            },
          },
        },
      },
    };
    keyring = {
      decryptSLHDSASessionState: jest.fn(stateCrypto.decrypt),
      encryptSLHDSASessionState: jest.fn(stateCrypto.encrypt),
      isUnlocked: jest.fn(() => true),
    };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 7;
    wallet.getActiveKeyring = jest.fn(() => keyring);
    await saveEncryptedSLHDSAState(
      provisioned(GUARDIAN_KEY, GUARDIAN_ID, 7),
      stateCrypto
    );
    await saveEncryptedSLHDSAState(
      provisioned(OTHER_KEY, OTHER_ID, 29),
      stateCrypto
    );
    jest.mocked(signSLHDSAInOffscreen).mockResolvedValue(SIGNATURE);
  });

  afterEach(() => clearRuntimeSLHDSAStates());

  const params = () => ({
    ...GUARDIAN_KEY,
    accountId: GUARDIAN_ID,
    actionHash: ACTION_HASH,
    keyId: getSLHDSAKeyId(GUARDIAN_KEY),
    parameterSet: SLH_DSA_PARAMETER_SET,
  });

  it.each(['cold after lock-like cleanup', 'warm'])(
    'signs the explicit guardian rather than the selected account (%s)',
    async (cacheStatus) => {
      if (cacheStatus === 'warm') {
        putRuntimeSLHDSAState(provisioned(GUARDIAN_KEY, GUARDIAN_ID, 7));
      } else {
        // Lock clears runtime state, but must retain encrypted durable state.
        clearRuntimeSLHDSAStates();
      }

      await expect(wallet.signSLHDSAActionHash(params())).resolves.toBe(
        SIGNATURE
      );

      expect(signSLHDSAInOffscreen).toHaveBeenCalledTimes(1);
      expect(signSLHDSAInOffscreen).toHaveBeenCalledWith(
        expect.objectContaining(params()),
        expect.any(Function)
      );
      const guardian = await loadEncryptedSLHDSAState({
        crypto: stateCrypto,
        keyId: getSLHDSAKeyId(GUARDIAN_KEY),
      });
      const other = await loadEncryptedSLHDSAState({
        crypto: stateCrypto,
        keyId: getSLHDSAKeyId(OTHER_KEY),
      });
      expect(guardian?.signatureCount).toBe(8);
      expect(other?.signatureCount).toBe(29);
      expect(mockState.vault.activeAccount.id).toBe(OTHER_ID);
      expect(mockStorage.has(getSLHDSAStateStorageKey(guardian!.keyId))).toBe(
        true
      );
    }
  );

  it.each([undefined, 999, OTHER_ID])(
    'does not cold-hydrate a guardian key for missing or unrelated account id %p',
    async (accountId) => {
      await expect(
        wallet.signSLHDSAActionHash({ ...params(), accountId })
      ).rejects.toThrow('metadata does not match');
      expect(signSLHDSAInOffscreen).not.toHaveBeenCalled();
      expect(keyring.decryptSLHDSASessionState).not.toHaveBeenCalled();
    }
  );

  it('refuses changed public key material after cold guardian hydration', async () => {
    await expect(
      wallet.signSLHDSAActionHash({ ...params(), pkRoot: OTHER_KEY.pkRoot })
    ).rejects.toThrow('metadata does not match the active validator');
    expect(signSLHDSAInOffscreen).not.toHaveBeenCalled();
  });

  it('cold-hydrates an installed SLH child of the explicit account active composite', async () => {
    const guardian =
      mockState.vault.accounts[KeyringAccountType.SmartAccount][GUARDIAN_ID];
    guardian.smartAccount.auth = { module: 'composite', validator: COMPOSITE };
    guardian.smartAccount.installedModules.push({
      address: COMPOSITE,
      config: { childValidators: [VALIDATOR], threshold: 1 },
      id: 'composite',
      type: 'validator',
    });
    await expect(wallet.signSLHDSAActionHash(params())).resolves.toBe(
      SIGNATURE
    );
    expect(signSLHDSAInOffscreen).toHaveBeenCalledTimes(1);
    expect(mockState.vault.activeAccount.id).toBe(OTHER_ID);
    const state = await loadEncryptedSLHDSAState({
      crypto: stateCrypto,
      keyId: params().keyId,
    });
    expect(state?.signatureCount).toBe(8);
  });

  it.each(['unrelated child', 'inactive composite'])(
    'does not hydrate a merely installed SLH key (%s)',
    async (reason) => {
      const guardian =
        mockState.vault.accounts[KeyringAccountType.SmartAccount][GUARDIAN_ID];
      guardian.smartAccount.auth = {
        module: 'composite',
        validator: COMPOSITE,
      };
      guardian.smartAccount.installedModules.push({
        address:
          reason === 'inactive composite' ? `0x${'bb'.repeat(20)}` : COMPOSITE,
        config: {
          childValidators: reason === 'unrelated child' ? [] : [VALIDATOR],
          threshold: 1,
        },
        id: 'composite',
        type: 'validator',
      });
      await expect(wallet.signSLHDSAActionHash(params())).rejects.toThrow(
        'metadata does not match'
      );
      expect(signSLHDSAInOffscreen).not.toHaveBeenCalled();
      expect(keyring.decryptSLHDSASessionState).not.toHaveBeenCalled();
    }
  );
});
