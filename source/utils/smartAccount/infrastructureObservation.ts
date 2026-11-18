import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';
import { readFreshEvmState } from '../../shared/evmReadPhase.ts';
import {
  readEvmRpcHash,
  readEvmRpcQuantity,
} from '../../shared/evmTransactionObservation.ts';

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

/** Cache immutable code observations only, separately from pending deployment state. */
export function createSmartAccountInfrastructureReader() {
  const entries = new Map<
    string,
    { bytes: number; codes: readonly string[] }
  >();
  let bytes = 0;
  return async function readInfrastructure({
    chainId,
    url,
    provider,
    readCodes,
    assertCurrent,
    forceRefresh = false,
  }: {
    assertCurrent(): void;
    chainId: number;
    forceRefresh?: boolean;
    provider: {
      send(method: string, params: unknown[]): Promise<any>;
      sendFresh?(method: string, params: unknown[]): Promise<any>;
      verifyConfiguredChainId(fresh?: boolean): Promise<void>;
    };
    readCodes(blockTag: string): Promise<unknown>;
    url: string;
  }): Promise<SmartAccountInfrastructureObservation> {
    const check = () => assertSynchronousEvmFeeGuard(assertCurrent);
    check();
    const [, head] = await Promise.all([
      provider.verifyConfiguredChainId(true),
      readFreshEvmState(provider, 'eth_getBlockByNumber', ['latest', false]),
    ]);
    check();
    const number = readEvmRpcQuantity(head?.number);
    const hash = readEvmRpcHash(head?.hash);
    const blockTag = `0x${number.toString(16)}`;
    const key = JSON.stringify([chainId, url, blockTag, hash]);
    const cached = forceRefresh ? undefined : entries.get(key);
    const codes = cached?.codes ?? (await readCodes(blockTag));
    check();
    if (!isInfrastructureCodeVector(codes))
      throw new Error(
        'Invalid infrastructure code response. Refresh status before deploying.'
      );
    const [, canonical] = await Promise.all([
      provider.verifyConfiguredChainId(true),
      readFreshEvmState(provider, 'eth_getBlockByNumber', [blockTag, false]),
    ]);
    check();
    if (
      readEvmRpcHash(canonical?.hash) !== hash ||
      readEvmRpcQuantity(canonical?.number) !== number
    )
      throw new Error('Smart account infrastructure block changed');
    const old = entries.get(key);
    if (old) {
      entries.delete(key);
      bytes -= old.bytes;
    }
    const size = codes.reduce(
      (total, code) => total + code.length * 2,
      key.length * 2
    );
    if (size <= 2 * 1024 * 1024) {
      entries.set(key, { codes: Object.freeze([...codes]), bytes: size });
      bytes += size;
      while (entries.size > 8 || bytes > 2 * 1024 * 1024) {
        const first = entries.keys().next().value!;
        bytes -= entries.get(first)!.bytes;
        entries.delete(first);
      }
    }
    return projectSmartAccountInfrastructureObservation(chainId, codes)!;
  };
}

export function assertSmartAccountInfrastructureReady(
  status: SmartAccountInfrastructureObservation
): void {
  if (!status.create2Deployer.deployed)
    throw new Error(
      'This network does not expose the canonical CREATE2 deployer required for deterministic Pali smart account deployment.'
    );
  if (!status.ready)
    throw new Error(
      'Pali smart account infrastructure is not deployed on this network. Deploy it first from Wallet Advanced settings, then try again.'
    );
}
