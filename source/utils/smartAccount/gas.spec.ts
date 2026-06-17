jest.unmock('@ethersproject/abi');
jest.unmock('@ethersproject/address');
jest.unmock('@ethersproject/bignumber');
jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/hash');
jest.unmock('@ethersproject/keccak256');
jest.unmock('@ethersproject/strings');

import { BigNumber } from '@ethersproject/bignumber';

import { PALI_ENTRYPOINT_V09_ADDRESS } from './contracts';
import {
  estimateSmartAccountCallGasLimit,
  estimateSmartAccountUserOpGas,
  getSmartAccountGasUnitsReserve,
  getSmartAccountPreVerificationGas,
  getSmartAccountValidatorProfile,
  getSmartAccountVerificationGasLimit,
  SMART_ACCOUNT_COMPOSITE_VERIFICATION_BASE_GAS,
  SMART_ACCOUNT_COMPOSITE_VERIFICATION_CHILD_GAS,
  SMART_ACCOUNT_DEFAULT_CALL_GAS_LIMIT,
  SMART_ACCOUNT_DEPLOYMENT_VERIFICATION_GAS,
  SMART_ACCOUNT_PENALTY_GAS_THRESHOLD,
  SMART_ACCOUNT_PRE_VERIFICATION_GAS,
  SMART_ACCOUNT_SLH_DSA_PRE_VERIFICATION_GAS,
  SMART_ACCOUNT_VERIFICATION_GAS_FALLBACK,
  SMART_ACCOUNT_VERIFICATION_GAS_LIMITS,
} from './gas';

const SENDER = '0x1111111111111111111111111111111111111111';
const CALL_DATA = '0xdeadbeef';

const providerWithEstimate = (gas: number | Error) =>
  ({
    estimateGas: jest.fn(async () => {
      if (gas instanceof Error) throw gas;
      return BigNumber.from(gas);
    }),
  } as any);

describe('estimateSmartAccountCallGasLimit', () => {
  it('subtracts intrinsic gas and applies the minimum margin floor', async () => {
    // estimate 60k -> inner 39k -> 10% margin (3.9k) below the 12k floor
    const provider = providerWithEstimate(60_000);
    const limit = await estimateSmartAccountCallGasLimit(provider, {
      callData: CALL_DATA,
      isDeployed: true,
      sender: SENDER,
    });
    expect(limit).toBe(39_000 + 12_000);
    expect(provider.estimateGas).toHaveBeenCalledWith({
      data: CALL_DATA,
      from: PALI_ENTRYPOINT_V09_ADDRESS,
      to: SENDER,
    });
  });

  it('applies a proportional margin for mid-size calls', async () => {
    // estimate 221k -> inner 200k -> margin 20k (between floor and cap)
    const provider = providerWithEstimate(221_000);
    const limit = await estimateSmartAccountCallGasLimit(provider, {
      callData: CALL_DATA,
      isDeployed: true,
      sender: SENDER,
    });
    expect(limit).toBe(200_000 + 20_000);
  });

  it('caps the margin below the penalty threshold', async () => {
    // estimate 1.021M -> inner 1M -> margin capped at 35k (< 40k threshold)
    const provider = providerWithEstimate(1_021_000);
    const limit = await estimateSmartAccountCallGasLimit(provider, {
      callData: CALL_DATA,
      isDeployed: true,
      sender: SENDER,
    });
    expect(limit).toBe(1_000_000 + 35_000);
    expect(limit - 1_000_000).toBeLessThan(SMART_ACCOUNT_PENALTY_GAS_THRESHOLD);
  });

  it('falls back to the default for undeployed accounts', async () => {
    const provider = providerWithEstimate(60_000);
    const limit = await estimateSmartAccountCallGasLimit(provider, {
      callData: CALL_DATA,
      isDeployed: false,
      sender: SENDER,
    });
    expect(limit).toBe(SMART_ACCOUNT_DEFAULT_CALL_GAS_LIMIT);
    expect(provider.estimateGas).not.toHaveBeenCalled();
  });

  it('falls back to the default when estimation fails', async () => {
    const provider = providerWithEstimate(new Error('execution reverted'));
    const limit = await estimateSmartAccountCallGasLimit(provider, {
      callData: CALL_DATA,
      isDeployed: true,
      sender: SENDER,
    });
    expect(limit).toBe(SMART_ACCOUNT_DEFAULT_CALL_GAS_LIMIT);
  });
});

describe('getSmartAccountVerificationGasLimit', () => {
  it('uses the per-validator table', () => {
    expect(
      getSmartAccountVerificationGasLimit({ validatorKind: 'ecdsa' })
    ).toBe(SMART_ACCOUNT_VERIFICATION_GAS_LIMITS.ecdsa);
    expect(
      getSmartAccountVerificationGasLimit({ validatorKind: 'p256-webauthn' })
    ).toBe(SMART_ACCOUNT_VERIFICATION_GAS_LIMITS['p256-webauthn']);
    expect(
      getSmartAccountVerificationGasLimit({ validatorKind: 'slh-dsa' })
    ).toBe(SMART_ACCOUNT_VERIFICATION_GAS_LIMITS['slh-dsa']);
  });

  it('scales composite with the child count', () => {
    expect(
      getSmartAccountVerificationGasLimit({
        childValidatorCount: 3,
        validatorKind: 'composite',
      })
    ).toBe(
      SMART_ACCOUNT_COMPOSITE_VERIFICATION_BASE_GAS +
        3 * SMART_ACCOUNT_COMPOSITE_VERIFICATION_CHILD_GAS
    );
    // Unknown arity assumes two children.
    expect(
      getSmartAccountVerificationGasLimit({ validatorKind: 'composite' })
    ).toBe(
      SMART_ACCOUNT_COMPOSITE_VERIFICATION_BASE_GAS +
        2 * SMART_ACCOUNT_COMPOSITE_VERIFICATION_CHILD_GAS
    );
  });

  it('falls back conservatively for unknown validators', () => {
    expect(getSmartAccountVerificationGasLimit({})).toBe(
      SMART_ACCOUNT_VERIFICATION_GAS_FALLBACK
    );
    expect(
      getSmartAccountVerificationGasLimit({ validatorKind: 'custom-0xabc' })
    ).toBe(SMART_ACCOUNT_VERIFICATION_GAS_FALLBACK);
  });

  it('adds the deployment budget when initCode is present', () => {
    expect(
      getSmartAccountVerificationGasLimit({
        includesDeployment: true,
        validatorKind: 'ecdsa',
      })
    ).toBe(
      SMART_ACCOUNT_VERIFICATION_GAS_LIMITS.ecdsa +
        SMART_ACCOUNT_DEPLOYMENT_VERIFICATION_GAS
    );
  });
});

describe('getSmartAccountPreVerificationGas', () => {
  it('uses a larger calldata budget for SLH-DSA signatures', () => {
    expect(getSmartAccountPreVerificationGas({ validatorKind: 'ecdsa' })).toBe(
      SMART_ACCOUNT_PRE_VERIFICATION_GAS
    );
    expect(
      getSmartAccountPreVerificationGas({ validatorKind: 'slh-dsa' })
    ).toBe(SMART_ACCOUNT_SLH_DSA_PRE_VERIFICATION_GAS);
  });
});

describe('getSmartAccountValidatorProfile', () => {
  it('reads the validator kind from auth metadata', () => {
    expect(
      getSmartAccountValidatorProfile({
        auth: { data: '0x', module: 'ecdsa', validator: SENDER },
      })
    ).toEqual({ childValidatorCount: 0, validatorKind: 'ecdsa' });
  });

  it('counts composite children from installed modules', () => {
    expect(
      getSmartAccountValidatorProfile({
        auth: { data: '0x', module: 'composite', validator: SENDER },
        installedModules: [
          {
            address: SENDER,
            config: { childValidators: [SENDER, SENDER, SENDER] },
            id: 'composite',
            type: 'validator',
          } as any,
        ],
      })
    ).toEqual({ childValidatorCount: 3, validatorKind: 'composite' });
  });
});

describe('estimateSmartAccountUserOpGas', () => {
  it('combines estimate, table and fixed preVerificationGas', async () => {
    const provider = providerWithEstimate(121_000);
    const estimate = await estimateSmartAccountUserOpGas(provider, {
      callData: CALL_DATA,
      isDeployed: true,
      sender: SENDER,
      validatorKind: 'ecdsa',
    });
    expect(estimate.callGasLimit).toBe(100_000 + 12_000);
    expect(estimate.verificationGasLimit).toBe(
      SMART_ACCOUNT_VERIFICATION_GAS_LIMITS.ecdsa
    );
    expect(estimate.preVerificationGas).toBe(
      SMART_ACCOUNT_PRE_VERIFICATION_GAS
    );
    expect(estimate.totalGasUnits).toBe(
      estimate.callGasLimit +
        estimate.verificationGasLimit +
        estimate.preVerificationGas
    );
  });

  it('uses the SLH-DSA preVerificationGas budget for PQ signatures', async () => {
    const provider = providerWithEstimate(121_000);
    const estimate = await estimateSmartAccountUserOpGas(provider, {
      callData: CALL_DATA,
      isDeployed: true,
      sender: SENDER,
      validatorKind: 'slh-dsa',
    });
    expect(estimate.preVerificationGas).toBe(
      SMART_ACCOUNT_SLH_DSA_PRE_VERIFICATION_GAS
    );
    expect(estimate.totalGasUnits).toBe(
      estimate.callGasLimit +
        estimate.verificationGasLimit +
        SMART_ACCOUNT_SLH_DSA_PRE_VERIFICATION_GAS
    );
  });
});

describe('getSmartAccountGasUnitsReserve', () => {
  it('covers what the builder signs for a native transfer (Max-send)', async () => {
    const metadata = {
      auth: { data: '0x', module: 'ecdsa' as const, validator: SENDER },
      isDeployed: true,
    };
    const reserve = getSmartAccountGasUnitsReserve(metadata);

    // A native transfer through execute() estimates ~90k; the signed limits
    // must stay below the reserve so Max-send never overdraws.
    const provider = providerWithEstimate(90_000);
    const estimate = await estimateSmartAccountUserOpGas(provider, {
      callData: CALL_DATA,
      isDeployed: true,
      sender: SENDER,
      validatorKind: 'ecdsa',
    });
    expect(reserve.gte(estimate.totalGasUnits)).toBe(true);

    // And it is dramatically tighter than the legacy flat 2.05M reserve.
    expect(reserve.lt(BigNumber.from(2_050_000))).toBe(true);
  });

  it('includes the deployment budget for undeployed accounts', () => {
    const deployed = getSmartAccountGasUnitsReserve({
      auth: { data: '0x', module: 'ecdsa', validator: SENDER },
      isDeployed: true,
    });
    const undeployed = getSmartAccountGasUnitsReserve({
      auth: { data: '0x', module: 'ecdsa', validator: SENDER },
      isDeployed: false,
    });
    expect(
      undeployed.sub(deployed).eq(SMART_ACCOUNT_DEPLOYMENT_VERIFICATION_GAS)
    ).toBe(true);
  });

  it('includes the larger SLH-DSA preVerificationGas in the reserve', () => {
    const reserve = getSmartAccountGasUnitsReserve({
      auth: { data: '0x', module: 'slh-dsa', validator: SENDER },
      isDeployed: true,
    });

    expect(reserve).toEqual(
      BigNumber.from(
        SMART_ACCOUNT_DEFAULT_CALL_GAS_LIMIT +
          SMART_ACCOUNT_VERIFICATION_GAS_LIMITS['slh-dsa'] +
          SMART_ACCOUNT_SLH_DSA_PRE_VERIFICATION_GAS
      )
    );
  });
});
