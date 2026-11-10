import { NativeOperationDrain } from './operationDrain.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import type { IPrivateNoteStatus } from '../../../../source/utils/privacy/privateVaultTypes.ts';
import type {
  IPrivacyDepositReview,
  IPrivacyDepositSubmission,
  IPrivacyTransactionsController,
} from '../../../../source/utils/privacy/transactionTypes.ts';

export type NativePrivateDepositSnapshot = Readonly<{
  phase:
    | 'idle'
    | 'preparing'
    | 'review'
    | 'submitting'
    | 'submitted'
    | 'unknown'
    | 'failed';
  review: IPrivacyDepositReview | null;
  result: IPrivacyDepositSubmission | null;
  status: IPrivateNoteStatus | null;
  checking: boolean;
  error: 'expired' | 'pending' | 'unavailable' | 'failed' | null;
}>;
type Host = Readonly<{
  assertCurrent(): void;
  transactions: IPrivacyTransactionsController;
  readStatus(noteId: string): Promise<IPrivateNoteStatus>;
  close(): Promise<void>;
}>;

function failureCode(error: unknown): NativePrivateDepositSnapshot['error'] {
  const message = error instanceof Error ? error.message : '';
  if (message === 'privacy_deposit_intent_expired') return 'expired';
  if (message === 'privacy_deposit_attempt_exists') return 'pending';
  if (
    message === 'privacy_wrong_chain' ||
    message === 'privacy_deposit_unsupported_account'
  )
    return 'unavailable';
  return 'failed';
}

/** The shared controller owns every note, fee, nonce and submission decision. */
export class NativePrivateDeposit {
  private snapshot: NativePrivateDepositSnapshot = Object.freeze({
    phase: 'idle',
    review: null,
    result: null,
    status: null,
    checking: false,
    error: null,
  });
  private readonly listeners = new Set<
    (snapshot: NativePrivateDepositSnapshot) => void
  >();
  private busy = false;
  private disposed = false;
  private readonly drain = new NativeOperationDrain();
  private readonly host: Host;
  private readonly signal: AbortSignal;
  constructor(host: Host, signal: AbortSignal) {
    this.host = host;
    this.signal = signal;
    this.check();
    signal.addEventListener('abort', this.onAbort, { once: true });
  }
  private readonly onAbort = () => {
    void this.dispose().catch(() => undefined);
  };
  private check() {
    if (this.disposed || this.signal.aborted)
      throw new Error('privacy_cancelled');
    assertSynchronousEvmFeeGuard(this.host.assertCurrent);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: (snapshot: NativePrivateDepositSnapshot) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private observeFailure() {
    try {
      assertSynchronousEvmFeeGuard(this.host.assertCurrent);
    } catch {
      /* The existing owner guard also publishes protected-storage quarantine. */
    }
  }
  private publish(update: Partial<NativePrivateDepositSnapshot>) {
    if (this.disposed) return;
    this.snapshot = Object.freeze({ ...this.snapshot, ...update });
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        /* Rendering cannot change custody state. */
      }
    }
  }
  async prepare(
    request: Parameters<IPrivacyTransactionsController['prepareDeposit']>[0]
  ): Promise<void> {
    if (this.busy || this.disposed) return;
    this.check();
    const previous = this.snapshot;
    const capturedRequest = { ...request };
    this.busy = true;
    const finish = this.drain.begin();
    this.publish({
      phase: 'preparing',
      review: null,
      result: null,
      status: null,
      error: null,
    });
    try {
      this.check();
      if (previous.review && !previous.result) {
        await this.host.transactions.discardDeposit(previous.review.intentId);
        this.check();
      }
      const review = await this.host.transactions.prepareDeposit(
        capturedRequest
      );
      this.check();
      this.publish({ phase: 'review', review });
    } catch (error) {
      this.observeFailure();
      this.publish({ phase: 'failed', error: failureCode(error) });
    } finally {
      this.busy = false;
      finish();
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
    const review = this.snapshot.review;
    this.busy = true;
    const finish = this.drain.begin();
    this.publish({ phase: 'submitting', error: null });
    let result: IPrivacyDepositSubmission | undefined;
    try {
      this.check();
      result = await this.host.transactions.submitDeposit(intentId);
      // The shared host already records a true ACK even if this screen retired.
      this.check();
      this.publish({ phase: result.phase, result });
    } catch (error) {
      this.observeFailure();
      const unsent =
        !!error &&
        typeof error === 'object' &&
        'transactionNotBroadcast' in error &&
        error.transactionNotBroadcast === true;
      this.publish(
        unsent
          ? { phase: 'failed', error: failureCode(error) }
          : {
              phase: 'unknown',
              result: result ?? {
                intentId,
                noteId: review.noteId,
                phase: 'unknown',
              },
            }
      );
    } finally {
      this.busy = false;
      finish();
    }
  }
  async refresh(): Promise<void> {
    if (this.busy || this.disposed || !this.snapshot.review) return;
    this.check();
    const { review, result } = this.snapshot;
    if (!result)
      return this.prepare({ poolId: review.poolId, noteId: review.noteId });
    this.busy = true;
    const finish = this.drain.begin();
    this.publish({ error: null, checking: true });
    try {
      this.check();
      const status = await this.host.readStatus(review.noteId);
      this.check();
      this.publish({ status: Object.freeze({ ...status }) });
    } catch (error) {
      this.observeFailure();
      this.publish({ error: failureCode(error) });
    } finally {
      this.busy = false;
      finish();
      this.publish({ checking: false });
    }
  }
  dispose(): Promise<void> {
    return this.drain.close(() => {
      this.disposed = true;
      this.signal.removeEventListener('abort', this.onAbort);
      this.listeners.clear();
    }, [() => this.host.transactions.close(), () => this.host.close()]);
  }
}

export type NativePrivateDepositView = Pick<NativePrivateDeposit, 'getSnapshot' | 'subscribe' | 'prepare' | 'confirm' | 'refresh' | 'dispose'>;
