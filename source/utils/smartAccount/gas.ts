import { BigNumber } from '@ethersproject/bignumber';

import type { ISmartAccountMetadata } from 'types/network';

import { PALI_ENTRYPOINT_V09_ADDRESS } from './contracts';
import type { Provider } from '@ethersproject/providers';

// ---------------------------------------------------------------------------
// Shared UserOperation gas estimator (ERC-4337 / EntryPoint v0.9).
//
// Replaces the legacy flat 1M/1M callGasLimit/verificationGasLimit and the
// duplicated 2.05M wallet-side gas reserve. Two consequences of the flat
// limits motivated this:
//   1. v0.9 charges a 10% penalty on unused callGasLimit above
//      PENALTY_GAS_THRESHOLD (40k), so every op paid ~80-95k of phantom gas.
//   2. The 2.05M reserve over-reserved Max-sends by 10-20x, leaving dust or
//      failing entirely.
//
// callGasLimit:        eth_estimateGas (from = EntryPoint, to = sender,
//                      data = execute calldata) + a margin capped below the
//                      penalty threshold so the penalty can never trigger.
// verificationGasLimit: static per-validator table. Limits are inside the
//                      signed userOpHash, so they cannot be tuned after
//                      signing. Unused verification gas is neither charged
//                      nor penalized -- it only raises the required prefund
//                      -- so the table holds conservative upper bounds.
// preVerificationGas:  fixed 50k. Pali self-bundles (no public mempool), so
//                      this only covers calldata + EntryPoint overhead.
// ---------------------------------------------------------------------------

/** v0.9 EntryPoint penalizes unused callGasLimit above this threshold. */
export const SMART_ACCOUNT_PENALTY_GAS_THRESHOLD = 40_000;

/** Fixed preVerificationGas for self-bundled ops. */
export const SMART_ACCOUNT_PRE_VERIFICATION_GAS = 50_000;

// eth_estimateGas includes the 21k intrinsic transaction cost, which the
// inner EntryPoint -> account call never pays.
const TX_INTRINSIC_GAS = 21_000;

// callGasLimit headroom: covers state drift between estimation and
// inclusion. Capped below the penalty threshold (with the intrinsic-gas
// overshoot accounted for) so unused gas stays penalty-free.
const CALL_GAS_MARGIN_MIN = 12_000;
const CALL_GAS_MARGIN_MAX = 35_000;

/**
 * Fallback callGasLimit when estimation is impossible (undeployed account --
 * the execute call cannot be simulated against empty code) or the RPC
 * estimate fails. Generous enough for transfers and module management; the
 * one-off penalty on the unused portion is accepted for these rare ops.
 */
export const SMART_ACCOUNT_DEFAULT_CALL_GAS_LIMIT = 250_000;

/**
 * Per-validator verificationGasLimit upper bounds (deployed accounts).
 * ECDSA: module lookup + ecrecover + account dispatch.
 * P256/WebAuthn: clientData/authenticatorData parsing + P256 precompile.
 * Composite: per-child validation on top of a dispatch base (see below).
 */
export const SMART_ACCOUNT_VERIFICATION_GAS_LIMITS: Record<
  'ecdsa' | 'p256-webauthn',
  number
> = {
  ecdsa: 200_000,
  'p256-webauthn': 350_000,
};

export const SMART_ACCOUNT_COMPOSITE_VERIFICATION_BASE_GAS = 150_000;
export const SMART_ACCOUNT_COMPOSITE_VERIFICATION_CHILD_GAS = 350_000;

/** Conservative fallback when the active validator kind is unknown. */
export const SMART_ACCOUNT_VERIFICATION_GAS_FALLBACK = 600_000;

/**
 * Extra verification budget when the op carries initCode: CREATE2 proxy
 * deployment + account initialization + initial module installs all run
 * inside the verification phase.
 */
export const SMART_ACCOUNT_DEPLOYMENT_VERIFICATION_GAS = 900_000;

export type SmartAccountValidatorKind = 'composite' | 'ecdsa' | 'p256-webauthn';

export type SmartAccountUserOpGasEstimate = {
  callGasLimit: number;
  preVerificationGas: number;
  /** Sum of all three limits; the prefund/reserve in gas units. */
  totalGasUnits: number;
  verificationGasLimit: number;
};

export const getSmartAccountVerificationGasLimit = ({
  childValidatorCount = 0,
  includesDeployment = false,
  validatorKind,
}: {
  childValidatorCount?: number;
  includesDeployment?: boolean;
  validatorKind?: SmartAccountValidatorKind | string;
}): number => {
  let verification: number;
  switch (validatorKind) {
    case 'ecdsa':
    case 'p256-webauthn':
      verification = SMART_ACCOUNT_VERIFICATION_GAS_LIMITS[validatorKind];
      break;
    case 'composite': {
      // Unknown composition degenerates to the fallback.
      const children = Math.max(1, childValidatorCount || 2);
      verification =
        SMART_ACCOUNT_COMPOSITE_VERIFICATION_BASE_GAS +
        children * SMART_ACCOUNT_COMPOSITE_VERIFICATION_CHILD_GAS;
      break;
    }
    default:
      verification = SMART_ACCOUNT_VERIFICATION_GAS_FALLBACK;
  }
  if (includesDeployment) {
    verification += SMART_ACCOUNT_DEPLOYMENT_VERIFICATION_GAS;
  }
  return verification;
};

/** Reads the active validator kind + composite arity out of the metadata. */
export const getSmartAccountValidatorProfile = (
  metadata: Pick<ISmartAccountMetadata, 'auth' | 'installedModules'>
): { childValidatorCount: number; validatorKind?: string } => {
  const validatorKind = metadata.auth?.module || metadata.auth?.scheme;
  if (validatorKind !== 'composite') {
    return { childValidatorCount: 0, validatorKind };
  }
  const compositeModule = metadata.installedModules?.find(
    (module) => module.type === 'validator' && module.id === 'composite'
  );
  const childValidatorCount =
    compositeModule && compositeModule.id === 'composite'
      ? compositeModule.config.childValidators?.length || 0
      : 0;
  return { childValidatorCount, validatorKind };
};

/**
 * Estimates the execution-phase gas for a userOp by simulating the
 * EntryPoint -> account execute call. Returns the limit including margin.
 */
export const estimateSmartAccountCallGasLimit = async (
  provider: Provider,
  {
    callData,
    isDeployed,
    sender,
  }: { callData: string; isDeployed: boolean; sender: string }
): Promise<number> => {
  if (!isDeployed) {
    return SMART_ACCOUNT_DEFAULT_CALL_GAS_LIMIT;
  }
  try {
    const estimate = await provider.estimateGas({
      data: callData,
      from: PALI_ENTRYPOINT_V09_ADDRESS,
      to: sender,
    });
    const inner = Math.max(estimate.toNumber() - TX_INTRINSIC_GAS, 0);
    const margin = Math.min(
      Math.max(Math.floor(inner / 10), CALL_GAS_MARGIN_MIN),
      CALL_GAS_MARGIN_MAX
    );
    return inner + margin;
  } catch (error) {
    // Estimation reverts bubble up at submission time with a clearer error;
    // here we fall back so signing flows can still present the op.
    return SMART_ACCOUNT_DEFAULT_CALL_GAS_LIMIT;
  }
};

export const estimateSmartAccountUserOpGas = async (
  provider: Provider,
  {
    callData,
    childValidatorCount = 0,
    isDeployed,
    sender,
    validatorKind,
  }: {
    callData: string;
    childValidatorCount?: number;
    isDeployed: boolean;
    sender: string;
    validatorKind?: SmartAccountValidatorKind | string;
  }
): Promise<SmartAccountUserOpGasEstimate> => {
  const callGasLimit = await estimateSmartAccountCallGasLimit(provider, {
    callData,
    isDeployed,
    sender,
  });
  const verificationGasLimit = getSmartAccountVerificationGasLimit({
    childValidatorCount,
    includesDeployment: !isDeployed,
    validatorKind,
  });
  return {
    callGasLimit,
    preVerificationGas: SMART_ACCOUNT_PRE_VERIFICATION_GAS,
    totalGasUnits:
      callGasLimit + verificationGasLimit + SMART_ACCOUNT_PRE_VERIFICATION_GAS,
    verificationGasLimit,
  };
};

/**
 * Gas-units reserve for balance checks and Max-send maths when no concrete
 * calldata exists yet (uses the fallback callGasLimit). Multiply by the gas
 * price to get the wei reserve. For a native transfer (the Max-send case)
 * the actual signed limits are far below this, so a Max-send can never
 * overdraw; heavy contract calls are gated per-op by the builder estimate.
 */
export const getSmartAccountGasUnitsReserve = (
  metadata: Pick<
    ISmartAccountMetadata,
    'auth' | 'installedModules' | 'isDeployed'
  >
): BigNumber => {
  const { childValidatorCount, validatorKind } =
    getSmartAccountValidatorProfile(metadata);
  const verification = getSmartAccountVerificationGasLimit({
    childValidatorCount,
    includesDeployment: !metadata.isDeployed,
    validatorKind,
  });
  return BigNumber.from(
    SMART_ACCOUNT_DEFAULT_CALL_GAS_LIMIT +
      verification +
      SMART_ACCOUNT_PRE_VERIFICATION_GAS
  );
};
