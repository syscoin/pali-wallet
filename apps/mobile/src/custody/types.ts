import type { EvmNetworkId } from './networkContext.ts';
import type { NativeNetworkRuntime, NativeAccountRuntime } from './accounts.ts';
import type { NativeImportRuntime } from './importedAccounts.ts';
import type { NativePrivateAuthentication } from './privateAuthentication.ts';
/** Public state only. Neither SDK state nor recovery material belongs here. */
export type CustodySnapshot = Readonly<{
  phase:
    | 'opening'
    | 'empty'
    | 'locked'
    | 'authenticating'
    | 'ready'
    | 'unavailable'
    | 'disposed';
  revision: number;
  presence: 'unknown' | 'empty' | 'existing';
  backup: 'unknown' | 'unconfirmed' | 'confirmed';
  account: Readonly<{ network: EvmNetworkId; address: string }> | null;
  error: CustodyErrorCode | null;
}>;

export type CustodyErrorCode =
  | 'NOT_READY'
  | 'BUSY'
  | 'INVALID_INPUT'
  | 'INVALID_CREDENTIAL'
  | 'AUTH_THROTTLED'
  | 'CANCELLED'
  | 'OPERATION_FAILED'
  | 'UNAVAILABLE'
  | 'CLEANUP_FAILED'
  | 'ACCOUNT_LIMIT'
  | 'ACCOUNT_NOT_REMOVABLE'
  | 'PENDING_TRANSFER'
  | 'DUPLICATE_ACCOUNT'
  | 'DEVICE_UNLOCK_UNAVAILABLE';

/** Explicit host errors; untyped SDK errors must never supply UI classifications. */
export class CustodyRuntimeError extends Error {
  readonly code: 'NOT_READY' | 'INVALID_INPUT' | 'INVALID_CREDENTIAL' | 'OPERATION_FAILED' | 'CANCELLED' | 'AUTH_THROTTLED' | 'CLEANUP_FAILED' | 'BUSY' | 'ACCOUNT_LIMIT' | 'ACCOUNT_NOT_REMOVABLE' | 'PENDING_TRANSFER' | 'DUPLICATE_ACCOUNT' | 'DEVICE_UNLOCK_UNAVAILABLE';
  constructor(code: CustodyRuntimeError['code']) {
    super(code);
    this.name = 'CustodyRuntimeError';
    this.code = code;
  }
}

export type CustodyStoredState =
  | Readonly<{ presence: 'empty'; backup: 'unconfirmed' }>
  | Readonly<{
      presence: 'existing';
      backup: 'unconfirmed' | 'confirmed';
    }>;

/**
 * Internal host boundary, not an application/UI service. A native factory must
 * qualify crypto/storage before returning a runtime. It owns one SDK authority,
 * never rebinds its store, and exposes only the selected public address here.
 */
/** Consent intent only. Actual private access always requires an OS-protected read. */
export type NativeOperationCredential = Readonly<{ method: 'device' }>;
declare const nativeOperationAuthorizationBrand: unique symbol;
/** Private one-use capability; only its owning runtime can recognize a receipt. */
export type NativeOperationAuthorization = Readonly<{ [nativeOperationAuthorizationBrand]: true }>;

export interface CustodyRuntime {
  readonly previewPhrase?: (phrase: string, assertCurrent: () => void) => Promise<readonly Readonly<{ label: string; address: string }>[]>;
  readonly accounts?: NativeAccountRuntime;
  readonly imports?: NativeImportRuntime;
  readonly networks?: NativeNetworkRuntime;
  readonly security?: {
    isAuthenticating(): boolean;
    isAuthenticationRefusal(error: unknown): boolean;
    authenticationStatus(): Promise<Readonly<{ deviceAuth: 'ready' | 'missing' | 'unsupported'; credentialPresent: boolean }>>;
    reauthenticateIdlePolicy(signal: AbortSignal, authentication: NativePrivateAuthentication, assertCurrent: () => void): Promise<void>;
  };
  readonly session: {
    createWallet(): Promise<void>;
    importWallet(phrase: string): Promise<void>;
    /** Only the SDK's explicit credential rejection maps to false. */
    unlock(): Promise<Readonly<{ authenticated: boolean }>>;
    readSelectedAddress(): Promise<string>;
    /** Must revoke secrets synchronously, before any asynchronous cleanup. */
    lock(): Promise<void>;
  };
  readonly storage: {
    /**
     * Missing, corrupt, incomplete and inaccessible stores are distinct. Throw
     * for every condition except a known empty or complete wallet. Backup status
     * must be bound to this wallet; creation/import starts unconfirmed.
     */
    readState(): Promise<CustodyStoredState>;
    /** Drain and revoke the runtime; capture its pair while the original lease is held, then close. */
    retireForRecovery?(): Promise<string>;
    /** Retire signing and drain outstanding work before an explicit removal on the original lease. */
    retireForRemoval?(remove: () => Promise<void>): Promise<void>;
    /** Wait for pending commits; never delete records as cleanup. */
    close(): Promise<void>;
  };
}

export interface CustodyRuntimeFactory {
  open(): Promise<CustodyRuntime>;
}
