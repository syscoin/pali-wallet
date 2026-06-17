jest.mock('./offscreenClient', () => ({
  prepareSLHDSAKeypairInOffscreen: jest.fn(),
  signSLHDSAInOffscreen: jest.fn(async () => `0x${'11'.repeat(3856)}`),
}));

const mockChromeStorage = new Map<string, unknown>();

jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: jest.fn(async (key: string) => mockChromeStorage.get(key) ?? null),
    removeItem: jest.fn(async (key: string) => {
      mockChromeStorage.delete(key);
    }),
    setItem: jest.fn(async (key: string, value: unknown) => {
      mockChromeStorage.set(key, value);
    }),
  },
}));

import {
  SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT,
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_ROTATION_SIGNATURE_RESERVE,
  SLH_DSA_SIGNATURE_LIMIT,
  clearRuntimeSLHDSAStates,
  configureSLHDSASessionStateCrypto,
  createSLHDSAProvisionedState,
  getSLHDSADerivationLabel,
  getSLHDSAPrecomputeCacheKey,
  getSLHDSAStateStorageKey,
  putRuntimeSLHDSAState,
  signSLHDSAActionHashLocal,
} from './index';

describe('slhDsa utilities', () => {
  afterEach(() => {
    clearRuntimeSLHDSAStates();
    mockChromeStorage.clear();
    jest.clearAllMocks();
  });

  it('uses versioned Pali derivation labels', () => {
    expect(getSLHDSADerivationLabel(7)).toBe(
      'PALI/SLH-DSA-SHA2-128-24/v1/account/7'
    );
  });

  it('uses separated storage keys for encrypted state and public precompute', () => {
    const keyId = '570:0xseed:0xroot';

    expect(getSLHDSAStateStorageKey(keyId)).toBe(
      'pali-slh-dsa-state:v1:570:0xseed:0xroot'
    );
    expect(getSLHDSAPrecomputeCacheKey(keyId)).toBe(
      'pali-slh-dsa-precompute:v1:570:0xseed:0xroot'
    );
  });

  it('creates bounded provisioned state without plaintext Redux fields', () => {
    const state = createSLHDSAProvisionedState({
      accountIndex: 0,
      derivationLabel: getSLHDSADerivationLabel(0),
      keyId: '570:0xseed:0xroot',
      pkRoot: '0x' + '11'.repeat(32),
      pkSeed: '0x' + '22'.repeat(32),
    });

    expect(state.parameterSet).toBe(SLH_DSA_PARAMETER_SET);
    expect('setupSecretHex' in state).toBe(false);
    expect(state.signatureCount).toBe(0);
    expect(state.signatureLimit).toBe(SLH_DSA_SIGNATURE_LIMIT);
    expect(state.signatureLimit).toBe(
      SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT - SLH_DSA_ROTATION_SIGNATURE_RESERVE
    );
  });

  it('fails closed when local signer state is not provisioned', async () => {
    await expect(
      signSLHDSAActionHashLocal({
        actionHash: '0x' + 'aa'.repeat(32),
        keyId: 'missing',
        parameterSet: SLH_DSA_PARAMETER_SET,
        pkRoot: '0x' + '11'.repeat(32),
        pkSeed: '0x' + '22'.repeat(32),
      })
    ).rejects.toThrow('not available in this unlocked session');
  });

  it('reserves an SLH-DSA signature budget for explicit validator rotation', async () => {
    configureSLHDSASessionStateCrypto({
      decrypt: (cipherText) => cipherText,
      encrypt: (plainText) => plainText,
    });
    const state = createSLHDSAProvisionedState({
      accountIndex: 0,
      derivationLabel: getSLHDSADerivationLabel(0),
      keyId: '570:0xseed:0xroot',
      pkRoot: '0x' + '11'.repeat(32),
      pkSeed: '0x' + '22'.repeat(32),
      secretKeyHex: '0x' + '33'.repeat(64),
    });
    putRuntimeSLHDSAState({
      ...state,
      signatureCount: SLH_DSA_SIGNATURE_LIMIT,
    });

    const signParams = {
      actionHash: '0x' + 'aa'.repeat(32),
      keyId: state.keyId,
      parameterSet: SLH_DSA_PARAMETER_SET,
      pkRoot: state.pkRoot,
      pkSeed: state.pkSeed,
    };

    await expect(signSLHDSAActionHashLocal(signParams)).rejects.toThrow(
      'signature limit reached'
    );
    await expect(
      signSLHDSAActionHashLocal({
        ...signParams,
        allowReservedSignature: true,
      })
    ).resolves.toMatch(/^0x/);
  });

  it('never signs past the absolute SLH-DSA signature limit', async () => {
    const state = createSLHDSAProvisionedState({
      accountIndex: 0,
      derivationLabel: getSLHDSADerivationLabel(0),
      keyId: '570:0xseed:0xroot',
      pkRoot: '0x' + '11'.repeat(32),
      pkSeed: '0x' + '22'.repeat(32),
      secretKeyHex: '0x' + '33'.repeat(64),
    });
    putRuntimeSLHDSAState({
      ...state,
      signatureCount: SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT,
    });

    await expect(
      signSLHDSAActionHashLocal({
        actionHash: '0x' + 'aa'.repeat(32),
        allowReservedSignature: true,
        keyId: state.keyId,
        parameterSet: SLH_DSA_PARAMETER_SET,
        pkRoot: state.pkRoot,
        pkSeed: state.pkSeed,
      })
    ).rejects.toThrow('signature limit reached');
  });
});
