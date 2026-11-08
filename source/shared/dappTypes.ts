import { getDappOrigin } from '../utils/dappOrigin.ts';

import type { INetwork, KeyringAccountType } from '../types/network';

export const MAX_DAPP_ORIGIN_LENGTH = 2048;

/** Persisted grants retain their existing extension data shape. */
export type DappGrant = {
  accountId: number;
  accountType: KeyringAccountType;
  chain: INetwork['kind'];
  chainId: number;
  date: number;
  host: string;
  logo?: string;
  utxoAccount?: { slip44: number; xpub: string };
};

export type DappAccountSelection = {
  address: string;
  network: Pick<INetwork, 'chainId' | 'kind' | 'slip44' | 'url'>;
  xpub?: string;
};

export type DappPublicAccount = {
  address: string;
  xpub: string;
};

/** A UTXO grant names a stable account, even when its receive address rotates. */
export function matchesDappAccountReference(
  grant: DappGrant | undefined,
  account: DappPublicAccount | undefined,
  network: Pick<INetwork, 'kind' | 'slip44'>
): boolean {
  if (!grant || !account || grant.chain !== network.kind) return false;
  const reference = grant.utxoAccount;
  return (
    network.kind !== 'syscoin' ||
    Boolean(
      reference &&
        Number.isSafeInteger(reference.slip44) &&
        reference.slip44 === (network.slip44 ?? 57) &&
        typeof reference.xpub === 'string' &&
        reference.xpub.length > 0 &&
        reference.xpub === account.xpub
    )
  );
}

export type DappPermissionMap = Readonly<Record<string, DappGrant>>;
export type DappPermissionFrame = Readonly<{
  dapps: DappPermissionMap;
  pendingOrigins: readonly string[];
}>;

/** Decode only persisted state. Live synchronization must retain committed marked grants. */
export function readStoredDappPermissions(value: unknown): DappPermissionFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid stored dapp permissions');
  const { dapps, pendingOrigins } = value as {
    dapps?: unknown;
    pendingOrigins?: unknown;
  };
  if (!dapps || typeof dapps !== 'object' || Array.isArray(dapps))
    throw new Error('Invalid stored dapp permissions');
  if (
    pendingOrigins !== undefined &&
    (!Array.isArray(pendingOrigins) ||
      pendingOrigins.length > 256 ||
      pendingOrigins.some(
        (origin) =>
          typeof origin !== 'string' ||
          origin.length > MAX_DAPP_ORIGIN_LENGTH ||
          getDappOrigin(origin) !== origin
      ) ||
      new Set(pendingOrigins).size !== pendingOrigins.length)
  )
    throw new Error('Invalid pending dapp permissions');
  const pending = (pendingOrigins ?? []) as string[];
  const grants = { ...dapps } as Record<string, DappGrant>;
  for (const origin of pending) delete grants[origin];
  return { dapps: grants, pendingOrigins: [...pending] };
}
