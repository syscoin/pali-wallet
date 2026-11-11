import {
  guardianRecoveryTerminalReason,
  type GuardianRecoveryTerminalReason,
} from '../../../../source/utils/smartAccount/guardianRecoveryLifecycle.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import type { GuardianRecoveryObservation } from '../../../../source/utils/smartAccount/guardianStatus.ts';
import type { NativePreparedConnectionTransaction } from '../connections/transactionRuntime.ts';
import type {
  NativeCatalogueAccount,
  NativeGuardianRecoveryIntent,
} from '../custody/walletCatalogue.ts';

export type NativeGuardianRecoveryDraft = Readonly<
  | {
      kind: 'start';
      guardianId: string;
      replacement: Readonly<{ kind: 'software'; accountId: string }> | Readonly<{ kind: 'passkey'; recreate: boolean }>;
      payerId: string;
    }
  | { kind: 'resume' }
>;
export type NativeGuardianRecoveryChoice = Readonly<{
  id: string;
  address: string;
  label: string;
}>;
export type NativeGuardianRecoveryChoices = Readonly<{
  passkeysAvailable: boolean;
  guardians: readonly NativeGuardianRecoveryChoice[];
  replacements: readonly NativeGuardianRecoveryChoice[];
  payers: readonly NativeGuardianRecoveryChoice[];
}>;

/** Public role choices; the host verifies current policy and signing eligibility. */
export function getNativeGuardianRecoveryChoices(
  accounts: readonly NativeCatalogueAccount[],
  chainId: number,
  passkeysAvailable: boolean
): NativeGuardianRecoveryChoices {
  const software: NativeGuardianRecoveryChoice[] = [],
    guardians: NativeGuardianRecoveryChoice[] = [];
  for (const account of accounts) {
    if (account.slip44 !== 60) continue;
    const isSoftware =
      account.type === 'HDAccount' || account.type === 'Imported';
    if (
      !isSoftware &&
      !(
        account.type === 'SmartAccount' &&
        account.smartAccount?.chainId === chainId
      )
    )
      continue;
    const choice = Object.freeze({
      id: account.id,
      address: account.address,
      label: account.label,
    });
    guardians.push(choice);
    if (isSoftware) software.push(choice);
  }
  return Object.freeze({
    passkeysAvailable,
    guardians: Object.freeze(guardians),
    replacements: Object.freeze(software),
    payers: Object.freeze([...software]),
  });
}
export type NativeGuardianRecoveryAction = 'schedule' | 'finalize';
export type NativeGuardianRecoveryStatus = Readonly<{
  intent: NativeGuardianRecoveryIntent;
  observation: GuardianRecoveryObservation;
  action: NativeGuardianRecoveryAction | null;
  transactionHash: string | null;
  terminal: 'executed' | 'obsolete' | null;
  canAbandon: boolean;
}>;
export type NativeGuardianRecoverySnapshot = Readonly<{
  phase:
    | 'preparing'
    | 'authorize'
    | 'review'
    | 'submitting'
    | 'waiting'
    | 'ready'
    | 'complete'
    | 'cleared'
    | 'failed'
    | 'unknown';
  revision: number;
  intent: NativeGuardianRecoveryIntent | null;
  observation: GuardianRecoveryObservation | null;
  action: NativeGuardianRecoveryAction | null;
  feeReview: Readonly<
    Pick<
      NativePreparedConnectionTransaction,
      | 'transaction'
      | 'maximumFeeUnits'
      | 'maximumTotalUnits'
      | 'expiresAtMonotonicMilliseconds'
    > & { id: number }
  > | null;
  transactionHash: string | null;
  error: string | null;
  canAbandon: boolean;
  metadataRefresh: 'complete' | 'failed' | null;
  terminalReason: Exclude<GuardianRecoveryTerminalReason, 'executed'> | null;
}>;
type Host = Readonly<{
  assertCurrent(): void;
  dispose(): void;
  submissionFailure(error: unknown):
    | Readonly<{
        transactionNotBroadcast: boolean;
        signedTransactionHash?: string;
      }>
    | undefined;
  observe(signal: AbortSignal): Promise<NativeGuardianRecoveryStatus>;
  prepare(
    action: NativeGuardianRecoveryAction,
    signal: AbortSignal
  ): Promise<NativePreparedConnectionTransaction>;
  reconcile(signal: AbortSignal): Promise<void>;
  abandon(signal: AbortSignal): Promise<void>;
}>;

function recoveryErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (['CANCELLED', 'NOT_READY', 'PROFILE_CHANGED'].includes(message))
    return 'The wallet changed or locked. Reopen recovery.';
  if (
    message === 'PALI_GUARDIAN_RECOVERY_POLICY_CHANGED' ||
    message === 'Recovery status changed'
  )
    return 'The recovery policy changed. Check its current status before continuing.';
  if (message === 'Review expired')
    return 'Review expired. Review the current fee again.';
  return 'Recovery is unavailable. Check its current status before trying again.';
}

/** Native presentation around existing shared recovery and transaction capabilities. */
export class NativeGuardianRecoveryController {
  private snapshot: NativeGuardianRecoverySnapshot = Object.freeze({
    phase: 'preparing',
    revision: 0,
    intent: null,
    observation: null,
    action: null,
    feeReview: null,
    transactionHash: null,
    error: null,
    canAbandon: false,
    metadataRefresh: null,
    terminalReason: null,
  });
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private prepared: NativePreparedConnectionTransaction | null = null;
  private busy = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly retire = () => this.dispose();
  private readonly host: Host;
  private readonly parent: AbortSignal;
  private readonly now: () => number;
  constructor(host: Host, parent: AbortSignal, now = () => performance.now()) {
    this.host = host;
    this.parent = parent;
    this.now = now;
    parent.addEventListener('abort', this.retire, { once: true });
    if (parent.aborted) this.dispose();
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private check() {
    if (this.disposed || this.lifetime.signal.aborted || this.parent.aborted)
      throw new Error('CANCELLED');
    assertSynchronousEvmFeeGuard(this.host.assertCurrent);
  }
  private publish(change: Partial<NativeGuardianRecoverySnapshot>) {
    if (this.disposed) return;
    this.snapshot = Object.freeze({
      ...this.snapshot,
      ...change,
      revision: this.snapshot.revision + 1,
    });
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Rendering does not own transaction authority. */
      }
    }
  }
  private clearReview() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.prepared = null;
  }
  private failed(
    error: unknown,
    phase: NativeGuardianRecoverySnapshot['phase'] = 'failed'
  ) {
    try {
      assertSynchronousEvmFeeGuard(this.host.assertCurrent);
    } catch {
      /* Surface storage quarantine through the host. */
    }
    this.clearReview();
    this.publish({
      phase,
      feeReview: null,
      error: recoveryErrorMessage(error),
    });
  }
  private async observe() {
    const status = await this.host.observe(this.lifetime.signal);
    this.check();
    const terminal =
      status.terminal === 'obsolete'
        ? guardianRecoveryTerminalReason(
            status.intent.operation,
            status.observation,
            status.transactionHash
          )
        : null;
    this.publish({
      terminalReason: terminal === 'executed' ? null : terminal,
      intent: status.intent,
      observation: status.observation,
      action: status.action,
      canAbandon: status.canAbandon,
      transactionHash: status.transactionHash ?? this.snapshot.transactionHash,
      error: null,
      phase:
        status.terminal === 'executed'
          ? 'complete'
          : status.terminal === 'obsolete'
          ? 'failed'
          : status.action === 'finalize'
          ? 'ready'
          : status.transactionHash
          ? 'waiting'
          : status.action === 'schedule'
          ? 'authorize'
          : 'waiting',
    });
    if (status.terminal === 'executed') await this.reconcile();
  }
  async prepare() {
    await this.refresh();
  }
  async refresh() {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.clearReview();
    this.publish({ feeReview: null, error: null });
    try {
      this.check();
      await this.observe();
    } catch (error) {
      this.failed(error, this.snapshot.transactionHash ? 'unknown' : 'failed');
    } finally {
      this.busy = false;
    }
  }
  async review() {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.clearReview();
    try {
      this.check();
      await this.observe();
      const action = this.snapshot.action;
      if (!action || this.snapshot.phase === 'complete') return;
      const prepared = await this.host.prepare(action, this.lifetime.signal);
      this.check();
      if (prepared.expiresAtMonotonicMilliseconds <= this.now())
        throw new Error('Review expired');
      this.prepared = prepared;
      const id = this.snapshot.revision + 1;
      this.publish({
        phase: 'review',
        error: null,
        feeReview: {
          id,
          transaction: prepared.transaction,
          maximumFeeUnits: prepared.maximumFeeUnits,
          maximumTotalUnits: prepared.maximumTotalUnits,
          expiresAtMonotonicMilliseconds:
            prepared.expiresAtMonotonicMilliseconds,
        },
      });
      this.timer = setTimeout(() => {
        this.clearReview();
        this.publish({
          phase: action === 'finalize' ? 'ready' : 'authorize',
          feeReview: null,
          error: 'Review expired. Review the current fee again.',
        });
      }, prepared.expiresAtMonotonicMilliseconds - this.now());
    } catch (error) {
      this.failed(error);
    } finally {
      this.busy = false;
    }
  }
  async confirm(reviewId: number) {
    if (
      this.busy ||
      this.disposed ||
      !this.prepared ||
      this.snapshot.feeReview?.id !== reviewId
    )
      return;
    this.busy = true;
    const prepared = this.prepared;
    this.clearReview();
    this.publish({ phase: 'submitting', feeReview: null, error: null });
    let entered = false;
    try {
      this.check();
      if (prepared.expiresAtMonotonicMilliseconds <= this.now())
        throw new Error('Review expired');
      entered = true;
      const hash = await prepared.submit(
        () => this.check(),
        (hash) => {
          this.publish({ transactionHash: hash, canAbandon: false });
        },
        { kind: 'transaction' }
      );
      this.check();
      this.publish({ transactionHash: hash, phase: 'waiting' });
      await this.observe();
    } catch (error) {
      const failure = this.host.submissionFailure(error);
      if (failure?.signedTransactionHash)
        this.publish({ transactionHash: failure.signedTransactionHash });
      this.failed(
        error,
        !entered || failure?.transactionNotBroadcast === true
          ? 'failed'
          : 'unknown'
      );
    } finally {
      this.busy = false;
    }
  }
  private async reconcile() {
    try {
      await this.host.reconcile(this.lifetime.signal);
      // The atomic commit can retire the captured account revision.
      this.publish({
        phase: 'complete',
        metadataRefresh: 'complete',
        canAbandon: false,
        error: null,
      });
      this.dispose();
    } catch (error) {
      try {
        assertSynchronousEvmFeeGuard(this.host.assertCurrent);
      } catch {
        /* Quarantine invalidates the host. */
      }
      this.publish({
        phase: 'complete',
        metadataRefresh: 'failed',
        error: recoveryErrorMessage(error),
      });
    }
  }
  async retryMetadata() {
    if (
      this.busy ||
      this.disposed ||
      this.snapshot.phase !== 'complete' ||
      this.snapshot.metadataRefresh !== 'failed'
    )
      return;
    this.busy = true;
    try {
      this.check();
      await this.reconcile();
    } finally {
      this.busy = false;
    }
  }
  async abandon() {
    if (this.busy || this.disposed || !this.snapshot.canAbandon) return;
    this.busy = true;
    this.clearReview();
    try {
      this.check();
      await this.host.abandon(this.lifetime.signal);
      this.publish({
        phase: 'cleared',
        terminalReason: null,
        feeReview: null,
        canAbandon: false,
        error: null,
      });
      this.dispose();
    } catch (error) {
      this.failed(error);
    } finally {
      this.busy = false;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort();
    this.clearReview();
    this.snapshot = Object.freeze({ ...this.snapshot, feeReview: null });
    this.listeners.clear();
    this.host.dispose();
    this.parent.removeEventListener('abort', this.retire);
  }
}
