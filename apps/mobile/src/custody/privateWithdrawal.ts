import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeApproval.ts';
import type { IPrivateNoteStatus } from '../../../../source/utils/privacy/privateVaultTypes.ts';
import type { PrivacyPoolId } from '../../../../source/utils/privacy/types.ts';
import type { IPrivacyProofProgress } from '../../../../source/utils/privacy/proverTypes.ts';
import type {
  IPrivacyRelayerChoice,
  IPrivacyWithdrawalPrepareRequest,
  IPrivacyWithdrawalReview,
  IPrivacyWithdrawalStatus,
  IPrivacyWithdrawalSubmission,
  IPrivacyWithdrawalsController,
} from '../../../../source/utils/privacy/withdrawTypes.ts';

export type NativePrivateWithdrawalSnapshot = Readonly<{
  phase:
    | 'idle'
    | 'preparing'
    | 'review'
    | 'submitting'
    | 'submitted'
    | 'unknown'
    | 'failed';
  canSign: boolean;
  relayers: readonly IPrivacyRelayerChoice[];
  progress: IPrivacyProofProgress | null;
  review: IPrivacyWithdrawalReview | null;
  result: IPrivacyWithdrawalSubmission | null;
  status: IPrivacyWithdrawalStatus | null;
  noteStatus: IPrivateNoteStatus | null;
  checking: boolean;
  restored: boolean;
  error:
    | 'expired'
    | 'pending'
    | 'verification'
    | 'restored'
    | 'unavailable'
    | 'failed'
    | null;
}>;

type Request = Omit<IPrivacyWithdrawalPrepareRequest, 'noteId'>;
type Host = Readonly<{
  assertCurrent(): void;
  canSign: boolean;
  restored: boolean;
  noteId: string;
  poolId: PrivacyPoolId;
  createWithdrawals(
    onProgress: (progress: IPrivacyProofProgress) => void
  ): IPrivacyWithdrawalsController;
  readNoteStatus(): Promise<IPrivateNoteStatus>;
  reviewRestored(password: string): Promise<void>;
  close(): Promise<void>;
}>;

function failureCode(error: unknown): NativePrivateWithdrawalSnapshot['error'] {
  const message = error instanceof Error ? error.message : '';
  if (message === 'privacy_withdrawal_intent_expired') return 'expired';
  if (
    message === 'privacy_withdrawal_attempt_exists' ||
    message === 'privacy_withdrawal_note_busy'
  )
    return 'pending';
  if (
    message === 'privacy_verification_pending' ||
    message === 'privacy_note_not_found'
  )
    return 'verification';
  if (message === 'privacy_note_restore_required') return 'restored';
  if (
    message === 'privacy_wrong_chain' ||
    message === 'privacy_withdrawal_unsupported_account'
  )
    return 'unavailable';
  return 'failed';
}

/** The shared engine owns the note, proof, review and submission authority. */
export class NativePrivateWithdrawal {
  private snapshot: NativePrivateWithdrawalSnapshot;
  private readonly listeners = new Set<
    (snapshot: NativePrivateWithdrawalSnapshot) => void
  >();
  private readonly withdrawals: IPrivacyWithdrawalsController;
  private busy = false;
  private disposed = false;
  private closing: Promise<void> | undefined;
  private readonly host: Host;
  private readonly signal: AbortSignal;

  constructor(host: Host, signal: AbortSignal) {
    this.host = host;
    this.signal = signal;
    this.check();
    this.snapshot = Object.freeze({
      phase: 'idle',
      canSign: host.canSign,
      restored: host.restored,
      relayers: Object.freeze([]),
      progress: null,
      review: null,
      result: null,
      status: null,
      noteStatus: null,
      checking: false,
      error: null,
    });
    this.withdrawals = host.createWithdrawals((progress) => {
      if (this.disposed || this.snapshot.phase !== 'preparing') return;
      this.check();
      this.publish({ progress: Object.freeze({ ...progress }) });
    });
    signal.addEventListener('abort', this.onAbort, { once: true });
  }

  private readonly onAbort = () => {
    void this.dispose().catch(() => undefined);
  };
  private check() {
    if (this.disposed || this.signal.aborted)
      throw new Error('privacy_withdrawal_cancelled');
    assertSynchronousEvmFeeGuard(this.host.assertCurrent);
  }
  private publish(update: Partial<NativePrivateWithdrawalSnapshot>) {
    if (this.disposed) return;
    this.snapshot = Object.freeze({ ...this.snapshot, ...update });
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        /* Rendering cannot change custody. */
      }
    }
  }
  private reportFailure(error: unknown) {
    try {
      assertSynchronousEvmFeeGuard(this.host.assertCurrent);
    } catch {
      /* Publish existing storage quarantine. */
    }
    this.publish({ error: failureCode(error) });
  }
  getSnapshot = () => this.snapshot;
  subscribe = (
    listener: (snapshot: NativePrivateWithdrawalSnapshot) => void
  ) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async prepare(request: Request): Promise<void> {
    if (this.busy || this.disposed) return;
    this.check();
    if (request.mode === 'direct' && !this.host.canSign) {
      this.publish({ error: 'unavailable' });
      return;
    }
    const previous = this.snapshot.review;
    this.busy = true;
    this.publish({
      phase: 'preparing',
      review: null,
      progress: null,
      error: null,
    });
    try {
      if (previous) await this.withdrawals.discardWithdrawal(previous.intentId);
      this.check();
      const review = await this.withdrawals.prepareWithdrawal({
        ...request,
        noteId: this.host.noteId,
      });
      this.check();
      this.publish({ phase: 'review', review, progress: null, result: null });
    } catch (error) {
      this.reportFailure(error);
      this.publish({ phase: 'failed', progress: null });
    } finally {
      this.busy = false;
    }
  }

  async confirm(intentId: string): Promise<void> {
    if (
      this.busy ||
      this.disposed ||
      this.snapshot.phase !== 'review' ||
      this.snapshot.review?.intentId !== intentId
    )
      return;
    this.check();
    this.busy = true;
    this.publish({ phase: 'submitting', error: null });
    let result: IPrivacyWithdrawalSubmission | undefined;
    try {
      result = await this.withdrawals.submitWithdrawal(intentId);
      this.check();
      this.publish({ phase: result.phase, result });
    } catch (error) {
      this.reportFailure(error);
      const unsigned =
        !!error &&
        typeof error === 'object' &&
        'transactionNotBroadcast' in error &&
        error.transactionNotBroadcast === true;
      this.publish(
        unsigned
          ? { phase: 'failed' }
          : {
              phase: 'unknown',
              result: result ?? {
                intentId,
                noteId: this.host.noteId,
                phase: 'unknown',
              },
            }
      );
    } finally {
      this.busy = false;
    }
  }

  async refresh(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.check();
    this.busy = true;
    this.publish({ checking: true, error: null });
    try {
      if (this.snapshot.review && !this.snapshot.result) {
        await this.withdrawals.discardWithdrawal(this.snapshot.review.intentId);
        this.check();
        this.publish({ phase: 'idle', review: null, progress: null });
      }
      const status = await this.withdrawals.statusByNote(this.host.noteId);
      this.check();
      this.publish({ status: Object.freeze({ ...status }) });
      const noteStatus = await this.host.readNoteStatus();
      this.check();
      this.publish({ noteStatus: Object.freeze({ ...noteStatus }) });
    } catch (error) {
      this.reportFailure(error);
    } finally {
      this.busy = false;
      this.publish({ checking: false });
    }
  }

  async loadRelayers(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.check();
    this.busy = true;
    this.publish({ checking: true, error: null });
    try {
      const relayers = await this.withdrawals.getRelayers();
      this.check();
      this.publish({
        relayers: Object.freeze(
          relayers
            .filter((relayer) =>
              relayer.supportedPools.includes(this.host.poolId)
            )
            .map((relayer) => Object.freeze({ ...relayer }))
        ),
      });
    } catch (error) {
      this.reportFailure(error);
    } finally {
      this.busy = false;
      this.publish({ checking: false });
    }
  }

  async reviewRestored(password: string): Promise<void> {
    if (this.busy || this.disposed) return;
    this.check();
    this.busy = true;
    this.publish({ checking: true, error: null });
    try {
      await this.host.reviewRestored(password);
      this.check();
      this.publish({ restored: false });
    } catch (error) {
      this.reportFailure(error);
      this.publish({ error: 'restored' });
    } finally {
      this.busy = false;
      this.publish({ checking: false });
    }
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.disposed = true;
    this.signal.removeEventListener('abort', this.onAbort);
    this.listeners.clear();
    this.withdrawals.close();
    this.closing = this.host.close();
    return this.closing;
  }
}

export type NativePrivateWithdrawalView = Pick<
  NativePrivateWithdrawal,
  | 'getSnapshot'
  | 'subscribe'
  | 'prepare'
  | 'confirm'
  | 'refresh'
  | 'loadRelayers'
  | 'reviewRestored'
  | 'dispose'
>;
