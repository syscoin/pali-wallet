import type { IKeyringAccountState } from '../types/network.ts';

export type SmartAccountModulesProjection = {
  activeValidator: string | null;
  address: string;
  chainId: `0x${string}`;
  deployed: boolean;
  installed: Array<{
    address: string;
    id: string;
    moduleType: 1 | 2;
    name: string | undefined;
  }>;
};

export class SmartAccountModulesProjectionError extends Error {
  readonly code: 'NOT_SMART_ACCOUNT' | 'WRONG_CHAIN' | 'INVALID_CHAIN';

  constructor(
    code: SmartAccountModulesProjectionError['code'],
    message: string
  ) {
    super(message);
    this.name = 'SmartAccountModulesProjectionError';
    this.code = code;
  }
}

/** Public connected-account inventory only; observation and authorization stay with the host. */
export function getSmartAccountModulesProjection(
  account: Pick<
    IKeyringAccountState,
    'address' | 'isSmartAccount' | 'smartAccount'
  >,
  chainId: number
): SmartAccountModulesProjection {
  if (!account?.isSmartAccount || !account.smartAccount)
    throw new SmartAccountModulesProjectionError(
      'NOT_SMART_ACCOUNT',
      'The connected account is not a smart account'
    );
  const metadata = account.smartAccount;
  if (
    !Number.isSafeInteger(chainId) ||
    chainId < 1 ||
    !Number.isSafeInteger(metadata.chainId) ||
    metadata.chainId < 1
  )
    throw new SmartAccountModulesProjectionError(
      'INVALID_CHAIN',
      'Smart account modules require valid numeric chain identifiers'
    );
  if (metadata.chainId !== chainId)
    throw new SmartAccountModulesProjectionError(
      'WRONG_CHAIN',
      `Smart account modules are only available on chain ${metadata.chainId}. Switch back from chain ${chainId} to inspect this account.`
    );
  return {
    address: account.address,
    chainId: `0x${chainId.toString(16)}`,
    deployed: Boolean(metadata.isDeployed),
    installed: (metadata.installedModules || []).map((module) => ({
      address: module.address,
      id: module.id,
      moduleType: module.type === 'validator' ? 1 : 2,
      name: module.id === 'custom' ? module.config?.name : undefined,
    })),
    activeValidator: metadata.auth?.validator || null,
  };
}
