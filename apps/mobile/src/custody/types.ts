import type { EvmNetworkId } from './networkContext.ts';
import type { NativeNetworkRuntime, NativeAccountRuntime } from './accounts.ts';
import type { NativeImportRuntime } from './importedAccounts.ts';
/** Public state only. Neither SDK state nor recovery material belongs here. */
export type CustodySnapshot = Readonly<{
  phase:
    | 'opening'
    | 'empty'
    | 'locked'
    | 'authenticating'
    | 'backup-required'
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
  | 'DUPLICATE_ACCOUNT';

/** Explicit host errors; untyped SDK errors must never supply UI classifications. */
export class CustodyRuntimeError extends Error {
  readonly code: 'NOT_READY' | 'INVALID_INPUT' | 'INVALID_CREDENTIAL' | 'OPERATION_FAILED' | 'CANCELLED' | 'AUTH_THROTTLED' | 'CLEANUP_FAILED' | 'BUSY' | 'ACCOUNT_LIMIT' | 'ACCOUNT_NOT_REMOVABLE' | 'PENDING_TRANSFER' | 'DUPLICATE_ACCOUNT';
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
 * never rebinds its store, and exposes only the selected Ethereum address here.
 */
export interface CustodyRuntime {
  readonly accounts?: NativeAccountRuntime;
  readonly imports?: NativeImportRuntime;
  readonly networks?: NativeNetworkRuntime;
  readonly security?: { reauthenticateIdlePolicy(password: string, assertCurrent: () => void): Promise<void> };
  readonly session: {
    createWallet(password: string): Promise<void>;
    importWallet(phrase: string, password: string): Promise<void>;
    /** Only the SDK's explicit credential rejection maps to false. */
    unlock(password: string): Promise<Readonly<{ authenticated: boolean }>>;
    readEthereumAddress(): Promise<string>;
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
    /** Wait for pending commits; never delete records as cleanup. */
    close(): Promise<void>;
  };
}

export interface CustodyRuntimeFactory {
  open(): Promise<CustodyRuntime>;
}
