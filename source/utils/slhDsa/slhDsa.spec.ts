import {
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_SIGNATURE_LIMIT,
  createSLHDSAProvisionedState,
  getSLHDSADerivationLabel,
  getSLHDSAPrecomputeCacheKey,
  getSLHDSAStateStorageKey,
  signSLHDSAActionHashLocal,
} from './index';

describe('slhDsa utilities', () => {
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
});
