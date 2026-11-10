import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeGuard.ts';

import type {
  SentryApprovalScope,
  SentrySettings,
  SentryNetwork,
} from './sentryApprovalTypes.ts';
import type {
  SentryCollateralAdmission,
  SentryCollateralReservation,
} from './sentryCollateral.ts';
import type { RunSentryCrypto } from './sentryCryptoJobs.ts';
import type { WalletAuthentication } from '../shared/walletAuthentication.ts';
import type { SentryAuthorityKey } from '@sidhujag/sysweb3-sentry';

export type SentryWalletAuthorityRequest = Readonly<{
  address: string;
  purpose: 'management' | 'voting';
}>;
export type SentrySigningMaterialRequest = Readonly<{
  assertCurrent(): void;
  authentication: WalletAuthentication;
  scope: SentryApprovalScope;
  signal: AbortSignal;
  walletAuthorities: readonly SentryWalletAuthorityRequest[];
}>;
export type SentrySigningMaterial = Readonly<{
  resolveWalletAuthority(
    request: SentryWalletAuthorityRequest
  ): { scheme: 'ecdsa'; secretKey: string } | undefined;
  seed: string;
}>;
export const sentryAuthorityRequestId = ({
  address,
  purpose,
}: SentryWalletAuthorityRequest) => `${purpose}:${address}`;

/** A retained callback cannot expand the requested authorities or outlive this action. */
export async function consumeSentrySigningMaterial<T>(
  request: SentrySigningMaterialRequest,
  seed: string,
  authorities: ReadonlyMap<
    string,
    { scheme: 'ecdsa'; secretKey: string } | undefined
  >,
  work: (material: SentrySigningMaterial) => Promise<T>
): Promise<T> {
  let active = true;
  const allowed = new Set(
    request.walletAuthorities.map(sentryAuthorityRequestId)
  );
  const check = () => {
    if (!active || request.signal.aborted)
      throw new Error('Sentry signing was cancelled');
    assertSynchronousEvmFeeGuard(request.assertCurrent);
    if (!active || request.signal.aborted)
      throw new Error('Sentry signing was cancelled');
  };
  try {
    check();
    const result = await work(
      Object.freeze({
        get seed() {
          check();
          return seed;
        },
        resolveWalletAuthority(value: SentryWalletAuthorityRequest) {
          check();
          const key = sentryAuthorityRequestId(value);
          if (!allowed.has(key))
            throw new Error('Unrequested Sentry wallet authority');
          return authorities.get(key);
        },
      })
    );
    check();
    return result;
  } finally {
    active = false;
    seed = '';
    for (const authority of authorities.values())
      if (authority) authority.secretKey = '';
  }
}

/** Browser adapter: existing password APIs remain the only credential path. */
export async function withPasswordSentrySigningMaterial<T>(
  request: SentrySigningMaterialRequest,
  work: (material: SentrySigningMaterial) => Promise<T>,
  ports: Readonly<{
    getSeed(password: string): Promise<string>;
    resolveWalletAuthority(
      authority: SentryWalletAuthorityRequest,
      password: string
    ): Promise<{ scheme: 'ecdsa'; secretKey: string } | undefined>;
  }>
): Promise<T> {
  if (typeof request.authentication !== 'string')
    throw new Error('Password authentication is required');
  const check = () => {
    if (request.signal.aborted) throw new Error('Sentry signing was cancelled');
    assertSynchronousEvmFeeGuard(request.assertCurrent);
  };
  const authorities = new Map<
    string,
    { scheme: 'ecdsa'; secretKey: string } | undefined
  >();
  let seed = '';
  try {
    check();
    seed = await ports.getSeed(request.authentication);
    check();
    for (const authority of request.walletAuthorities) {
      authorities.set(
        sentryAuthorityRequestId(authority),
        await ports.resolveWalletAuthority(authority, request.authentication)
      );
      check();
    }
    return await consumeSentrySigningMaterial(request, seed, authorities, work);
  } finally {
    seed = '';
    for (const authority of authorities.values())
      if (authority) authority.secretKey = '';
    authorities.clear();
  }
}

/** Custody, transport and execution stay with the exact captured wallet owner. */
export type SentryApprovalHost = Readonly<{
  assertCurrent(scope: SentryApprovalScope): void;
  captureScope(): SentryApprovalScope;
  getSettings(scope: SentryApprovalScope): Promise<SentrySettings>;
  hasWalletAuthority(
    address: string,
    scope: SentryApprovalScope
  ): Promise<boolean>;
  loadKey(params: {
    assertCurrent: () => void;
    id: string;
    network: SentryNetwork;
    scope: SentryApprovalScope;
    seed: string;
  }): Promise<SentryAuthorityKey>;
  readJson(
    url: string,
    limit: number,
    scope: SentryApprovalScope,
    assertCurrent: () => void,
    signal: AbortSignal
  ): Promise<any>;
  runCrypto: RunSentryCrypto;
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  withSigningMaterial<T>(
    request: SentrySigningMaterialRequest,
    work: (material: SentrySigningMaterial) => Promise<T>
  ): Promise<T>;
}>;

export type SentryOperationHost = SentryApprovalHost &
  Readonly<{
    captureCollateralAdmission(
      scope: SentryApprovalScope
    ): Promise<SentryCollateralAdmission>;
    network(scope: SentryApprovalScope): SentryNetwork;
    ownsCollateral(
      outpoint: { txid: string; vout: number },
      scope: SentryApprovalScope
    ): Promise<boolean>;
    reserveCollateral(
      scope: SentryApprovalScope,
      params: {
        admission: SentryCollateralAdmission;
        reservation: SentryCollateralReservation;
      },
      assertCurrent: () => void
    ): Promise<void>;
  }>;
