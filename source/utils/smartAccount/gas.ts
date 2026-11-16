import { Network } from 'ethers/providers';

import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';
import { BigNumber } from '../ethersV6Compat.ts';

import type { SmartAccountPackedUserOperation } from './account.ts';
import { PALI_ENTRYPOINT_V09_ADDRESS } from './contracts.ts';
import type { ISmartAccountMetadata } from '../../types/network.ts';
import type { Provider } from '../ethersV6Compat.ts';

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
//                      data = execute calldata), less qualified transaction
//                      overhead, plus a bounded execution margin.
// verificationGasLimit: static per-validator table. Limits are inside the
//                      signed userOpHash, so they cannot be tuned after
//                      signing. Unused verification gas is neither charged
//                      nor penalized -- it only raises the required prefund
//                      -- so the table holds conservative upper bounds.
// preVerificationGas:  validator-aware calldata + EntryPoint overhead budget.
//                      Pali self-bundles, but this still affects prefund.
// ---------------------------------------------------------------------------

/** v0.9 EntryPoint penalizes unused callGasLimit above this threshold. */
export const SMART_ACCOUNT_PENALTY_GAS_THRESHOLD = 40_000;

/** Base preVerificationGas for self-bundled ops with compact signatures. */
export const SMART_ACCOUNT_PRE_VERIFICATION_GAS = 50_000;

/**
 * SLH-DSA signatures are ~3.8 KB plus the validator prefix in calldata. This
 * is inside the signed userOp hash, so budget it before signing.
 */
export const SMART_ACCOUNT_SLH_DSA_PRE_VERIFICATION_GAS = 130_000;

// callGasLimit headroom: covers state drift between estimation and
// inclusion. A transaction calldata floor can leave additional conservative
// allowance in the estimate even after ordinary intrinsic gas is removed.
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
  'ecdsa' | 'p256-webauthn' | 'slh-dsa',
  number
> = {
  ecdsa: 200_000,
  'p256-webauthn': 350_000,
  'slh-dsa': 700_000,
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

export type SmartAccountValidatorKind =
  | 'composite'
  | 'ecdsa'
  | 'p256-webauthn'
  | 'slh-dsa';

export type SmartAccountUserOpGasEstimate = {
  callGasLimit: number;
  preVerificationGas: number;
  /** Sum of all three limits; the prefund/reserve in gas units. */
  totalGasUnits: number;
  verificationGasLimit: number;
};

const compositeChildCount = (count: number): number =>
  Number.isSafeInteger(count) && count > 0 ? count : 2;

const compositeSlhCount = (count: number, children: number): number =>
  Number.isSafeInteger(count) && count > 0 ? Math.min(children, count) : 0;

export const getSmartAccountVerificationGasLimit = ({
  childValidatorCount = 0,
  includesDeployment = false,
  slhDsaChildCount = 0,
  validatorKind,
}: {
  childValidatorCount?: number;
  includesDeployment?: boolean;
  slhDsaChildCount?: number;
  validatorKind?: SmartAccountValidatorKind | string;
}): number => {
  let verification: number;
  switch (validatorKind) {
    case 'ecdsa':
    case 'p256-webauthn':
    case 'slh-dsa':
      verification = SMART_ACCOUNT_VERIFICATION_GAS_LIMITS[validatorKind];
      break;
    case 'composite': {
      // Unknown composition degenerates to the fallback.
      const children = compositeChildCount(childValidatorCount);
      verification =
        SMART_ACCOUNT_COMPOSITE_VERIFICATION_BASE_GAS +
        children * SMART_ACCOUNT_COMPOSITE_VERIFICATION_CHILD_GAS +
        compositeSlhCount(slhDsaChildCount, children) *
          (SMART_ACCOUNT_VERIFICATION_GAS_LIMITS['slh-dsa'] -
            SMART_ACCOUNT_COMPOSITE_VERIFICATION_CHILD_GAS);
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

export const getSmartAccountPreVerificationGas = ({
  childValidatorCount = 0,
  slhDsaChildCount = 0,
  validatorKind,
}: {
  childValidatorCount?: number;
  slhDsaChildCount?: number;
  validatorKind?: SmartAccountValidatorKind | string;
}): number => {
  if (validatorKind === 'slh-dsa')
    return SMART_ACCOUNT_SLH_DSA_PRE_VERIFICATION_GAS;
  if (validatorKind !== 'composite') return SMART_ACCOUNT_PRE_VERIFICATION_GAS;
  const children = compositeChildCount(childValidatorCount);
  // Each aligned bytes[] child adds ABI framing and a compact signature.
  // PQ children additionally retain the standalone SLH calldata budget.
  return (
    SMART_ACCOUNT_PRE_VERIFICATION_GAS +
    children * 4096 +
    compositeSlhCount(slhDsaChildCount, children) *
      (SMART_ACCOUNT_SLH_DSA_PRE_VERIFICATION_GAS -
        SMART_ACCOUNT_PRE_VERIFICATION_GAS)
  );
};

/** Reads the active validator kind + composite arity out of the metadata. */
export const getSmartAccountValidatorProfile = (
  metadata: Pick<ISmartAccountMetadata, 'auth' | 'installedModules'>
): {
  childValidatorCount: number;
  slhDsaChildCount?: number;
  validatorKind?: string;
} => {
  const validatorKind = metadata.auth?.module || metadata.auth?.scheme;
  if (validatorKind !== 'composite') {
    return { childValidatorCount: 0, validatorKind };
  }
  const compositeModule = metadata.installedModules?.find(
    (module) =>
      module.type === 'validator' &&
      module.id === 'composite' &&
      module.address.toLowerCase() === metadata.auth?.validator?.toLowerCase()
  );
  const childValidatorCount =
    compositeModule && compositeModule.id === 'composite'
      ? compositeModule.config.childValidators?.length || 0
      : 0;
  const slhDsaChildCount =
    compositeModule?.id === 'composite'
      ? compositeModule.config.childValidators?.filter((child) =>
          metadata.installedModules?.some(
            (module) =>
              module.type === 'validator' &&
              module.id === 'slh-dsa' &&
              module.address.toLowerCase() === child.toLowerCase()
          )
        ).length || 0
      : 0;
  return {
    childValidatorCount,
    ...(slhDsaChildCount ? { slhDsaChildCount } : {}),
    validatorKind,
  };
};

type SmartExecutionGasInput = {
  callData: string;
  chainId?: number;
  entryPointAddress?: string;
  sender: string;
};

/** Transaction intrinsic is excluded only for the qualified chain model. */
async function readSmartAccountExecutionGas(
  provider: Provider,
  {
    callData,
    chainId,
    entryPointAddress = PALI_ENTRYPOINT_V09_ADDRESS,
    sender,
  }: SmartExecutionGasInput
): Promise<bigint> {
  if (typeof callData !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(callData))
    throw new Error('Invalid smart account execution calldata');
  const estimate = await provider.estimateGas({
    data: callData,
    from: entryPointAddress,
    to: sender,
  });
  const encoded =
    typeof estimate === 'bigint' ? estimate.toString() : estimate?.toString();
  if (typeof encoded !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(encoded))
    throw new Error('Invalid smart account execution gas estimate');
  const estimated = BigInt(encoded);
  // Mainnet and Hoodi retain ordinary transaction intrinsic pricing through
  // Fusaka. Sepolia's activated Glamsterdam and unqualified EVM/L2 models
  // retain the full transaction estimate until their model is qualified.
  // https://blog.ethereum.org/2026/10/22/glamsterdam-hoodi-delay
  // Under EIP-7623, estimate = max(intrinsic + execution, calldata floor).
  // Removing only ordinary intrinsic preserves an execution upper bound.
  const intrinsic =
    chainId === 1 || chainId === 560048
      ? BigInt(
          Network.from(chainId).computeIntrinsicGas({
            to: sender,
            data: callData,
          })
        )
      : BigInt(0);
  if (estimated < intrinsic || estimated > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Invalid smart account execution gas estimate');
  return estimated - intrinsic;
}

/** Recheck the exact signed execution budget without quote fallback or a new margin. */
export async function assertSmartAccountExecutionGas(
  provider: Provider,
  userOperation: SmartAccountPackedUserOperation,
  chainId: number,
  assertCurrent: () => void
): Promise<void> {
  assertSynchronousEvmFeeGuard(assertCurrent);
  if (!/^0x[0-9a-f]{64}$/i.test(userOperation.accountGasLimits))
    throw new Error('Invalid signed smart account gas limits');
  const signed = BigInt('0x' + userOperation.accountGasLimits.slice(34));
  if (signed === BigInt(0))
    throw new Error('Invalid signed smart account gas limits');
  const required = await readSmartAccountExecutionGas(provider, {
    callData: userOperation.callData,
    chainId,
    sender: userOperation.sender,
  });
  assertSynchronousEvmFeeGuard(assertCurrent);
  if (required > signed)
    throw new Error(
      'Smart account execution gas changed. Review the operation again.'
    );
}

/** Estimate the execution budget plus margin. Undeployed or unavailable quotes use the existing fallback. */
export const estimateSmartAccountCallGasLimit = async (
  provider: Provider,
  { isDeployed, ...input }: SmartExecutionGasInput & { isDeployed: boolean }
): Promise<number> => {
  if (!isDeployed) return SMART_ACCOUNT_DEFAULT_CALL_GAS_LIMIT;
  try {
    const inner = Number(await readSmartAccountExecutionGas(provider, input));
    const margin = Math.min(
      Math.max(Math.floor(inner / 10), CALL_GAS_MARGIN_MIN),
      CALL_GAS_MARGIN_MAX
    );
    return inner + margin;
  } catch {
    return SMART_ACCOUNT_DEFAULT_CALL_GAS_LIMIT;
  }
};

export const estimateSmartAccountUserOpGas = async (
  provider: Provider,
  {
    callData,
    chainId,
    childValidatorCount = 0,
    entryPointAddress,
    isDeployed,
    sender,
    slhDsaChildCount = 0,
    validatorKind,
  }: {
    callData: string;
    chainId?: number;
    childValidatorCount?: number;
    entryPointAddress?: string;
    isDeployed: boolean;
    sender: string;
    slhDsaChildCount?: number;
    validatorKind?: SmartAccountValidatorKind | string;
  }
): Promise<SmartAccountUserOpGasEstimate> => {
  const callGasLimit = await estimateSmartAccountCallGasLimit(provider, {
    callData,
    chainId,
    entryPointAddress,
    isDeployed,
    sender,
  });
  const verificationGasLimit = getSmartAccountVerificationGasLimit({
    childValidatorCount,
    includesDeployment: !isDeployed,
    slhDsaChildCount,
    validatorKind,
  });
  const preVerificationGas = getSmartAccountPreVerificationGas({
    childValidatorCount,
    slhDsaChildCount,
    validatorKind,
  });
  return {
    callGasLimit,
    preVerificationGas,
    totalGasUnits: callGasLimit + verificationGasLimit + preVerificationGas,
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
  const { childValidatorCount, slhDsaChildCount, validatorKind } =
    getSmartAccountValidatorProfile(metadata);
  const verification = getSmartAccountVerificationGasLimit({
    childValidatorCount,
    includesDeployment: !metadata.isDeployed,
    slhDsaChildCount,
    validatorKind,
  });
  const preVerificationGas = getSmartAccountPreVerificationGas({
    childValidatorCount,
    slhDsaChildCount,
    validatorKind,
  });
  return BigNumber.from(
    SMART_ACCOUNT_DEFAULT_CALL_GAS_LIMIT + verification + preVerificationGas
  );
};
