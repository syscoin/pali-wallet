import type {
  SentryApprovalScope,
  SentryRequestScope,
  SentrySettings,
  SentryNetwork,
} from './sentryApprovalTypes.ts';
import type {
  SentryCollateralAdmission,
  SentryCollateralReservation,
} from './sentryCollateral.ts';
import type { RunSentryCrypto } from './sentryCryptoJobs.ts';
import type { SentryAuthorityKey } from '@sidhujag/sysweb3-sentry';

/** Custody, transport and execution stay with the exact captured wallet owner. */
export type SentryApprovalHost = Readonly<{
  assertCurrent(scope: SentryApprovalScope): void;
  captureApprovalScope(origin: string): SentryRequestScope;
  captureScope(): SentryApprovalScope;
  getSeed(
    password: string,
    scope: SentryApprovalScope,
    assertCurrent: () => void
  ): Promise<string>;
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
    assertCurrent: () => void
  ): Promise<any>;
  resolveWalletAuthority(
    params: { address: string; password: string },
    scope: SentryApprovalScope
  ): Promise<{ scheme: 'ecdsa'; secretKey: string } | undefined>;
  runCrypto: RunSentryCrypto;
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
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
