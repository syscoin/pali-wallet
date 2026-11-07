import {
  PALI_CREATE2_DEPLOYER_ADDRESS,
  PALI_CREATE2_DEPLOYER_MIN_RUNTIME_BYTE_LENGTH,
  PALI_INFRASTRUCTURE_METADATA,
} from './deploymentMetadata.ts';

/** Request order for the code observations. The caller owns the RPC context. */
export const SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES = Object.freeze([
  PALI_CREATE2_DEPLOYER_ADDRESS,
  ...PALI_INFRASTRUCTURE_METADATA.map(({ address }) => address),
]);

function isInfrastructureCodeVector(
  codes: unknown
): codes is [string, ...string[]] {
  return (
    Array.isArray(codes) &&
    codes.length === SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES.length &&
    SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES.every((_, index) => {
      const code: unknown = codes[index];
      return typeof code === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(code);
    })
  );
}

/** Reports observed code presence. This does not attest deployment identity. */
export function projectSmartAccountInfrastructureObservation(
  chainId: number,
  codes: unknown
) {
  if (!isInfrastructureCodeVector(codes)) return undefined;
  const contracts = PALI_INFRASTRUCTURE_METADATA.map((contract, index) => ({
    address: contract.address,
    deployed: codes[index + 1] !== '0x',
    displayName: contract.displayName,
    externallyDeployed: Boolean(contract.externallyDeployed),
    id: contract.id,
    optional: Boolean(contract.optional),
  }));
  return {
    chainId,
    contracts,
    create2Deployer: {
      address: PALI_CREATE2_DEPLOYER_ADDRESS,
      deployed:
        (codes[0].length - 2) / 2 >=
        PALI_CREATE2_DEPLOYER_MIN_RUNTIME_BYTE_LENGTH,
    },
    missing: contracts.filter(({ deployed }) => !deployed).map(({ id }) => id),
    // The CREATE2 deployer is reported separately from the required contracts.
    ready: contracts.every(({ deployed, optional }) => deployed || optional),
  };
}

export type SmartAccountInfrastructureObservation = NonNullable<
  ReturnType<typeof projectSmartAccountInfrastructureObservation>
>;
