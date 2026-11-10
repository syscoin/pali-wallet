import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import {
  PALI_INFRASTRUCTURE_METADATA,
  type PaliInfrastructureContractId,
} from '../../../../source/utils/smartAccount/deploymentMetadata.ts';
import type { SmartAccountInfrastructureObservation } from '../../../../source/utils/smartAccount/infrastructureObservation.ts';
import type { NativePreparedConnectionTransaction } from '../connections/transactionRuntime.ts';

export type NativeInfrastructureStatus = Readonly<{
  observation: SmartAccountInfrastructureObservation;
  pending: Readonly<{
    contractId: PaliInfrastructureContractId;
    transactionHash: string | null;
  }> | null;
}>;

export type NativeInfrastructureFeeReview = Readonly<
  Pick<NativePreparedConnectionTransaction,
    'transaction' | 'maximumFeeUnits' | 'maximumTotalUnits' | 'expiresAtMonotonicMilliseconds'> & {
    id: number;
    contract: Readonly<{ id: PaliInfrastructureContractId; address: string; displayName: string; optional: boolean }>;
  }
>;

export type NativeInfrastructureSnapshot = Readonly<{
  phase: 'loading' | 'ready' | 'preparing' | 'review' | 'submitting' | 'pending' | 'complete' | 'failed' | 'unknown';
  revision: number;
  status: NativeInfrastructureStatus | null;
  feeReview: NativeInfrastructureFeeReview | null;
  /** Public translation key; RPC errors never enter the presentation. */
  error: string | null;
}>;

type Host = Readonly<{
  networkLabel: string;
  currencySymbol: string;
  payerLabel: string;
  payerAddress: string;
  assertCurrent(): void;
  dispose(): void;
  observe(signal: AbortSignal): Promise<NativeInfrastructureStatus>;
  prepare(contractId: PaliInfrastructureContractId, signal: AbortSignal): Promise<NativePreparedConnectionTransaction>;
  submissionFailure(error: unknown): Readonly<{
    transactionNotBroadcast: boolean;
    signedTransactionHash?: string;
  }> | undefined;
}>;

function errorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Review expired') return 'mobile.infrastructure.reviewExpired';
  if (['CANCELLED', 'NOT_READY', 'PROFILE_CHANGED'].includes(message)) return 'mobile.infrastructure.cancelled';
  return 'mobile.infrastructure.unavailable';
}

/** The host owns journal reconciliation. Code presence is an observation, not an identity attestation. */
export class NativeInfrastructureController {
  readonly networkLabel: string;
  readonly currencySymbol: string;
  readonly payerLabel: string;
  readonly payerAddress: string;
  private snapshot: NativeInfrastructureSnapshot = Object.freeze({
    phase: 'loading', revision: 0, status: null, feeReview: null, error: null,
  });
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private readonly submitted = new WeakSet<NativePreparedConnectionTransaction>();
  private prepared: NativePreparedConnectionTransaction | null = null;
  private operation: object | null = null;
  private publishing = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly retire = () => this.dispose();
  private readonly host: Host;
  private readonly parent: AbortSignal;
  private readonly now: () => number;

  constructor(host: Host, parent: AbortSignal, now = () => performance.now()) {
    for (const port of ['assertCurrent', 'dispose', 'observe', 'prepare', 'submissionFailure'] as const)
      if (typeof host[port] !== 'function') throw new Error('Infrastructure host ports are required');
    for (const label of ['networkLabel', 'currencySymbol', 'payerLabel', 'payerAddress'] as const)
      if (typeof host[label] !== 'string' || !host[label]) throw new Error('Infrastructure context is required');
    this.host = host;
    this.parent = parent;
    this.now = now;
    this.networkLabel = host.networkLabel;
    this.currencySymbol = host.currencySymbol;
    this.payerLabel = host.payerLabel;
    this.payerAddress = host.payerAddress;
    parent.addEventListener('abort', this.retire, { once: true });
    if (parent.aborted) this.dispose();
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    if (!this.disposed) this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private check(operation?: object) {
    const active = () => !this.disposed && !this.lifetime.signal.aborted && !this.parent.aborted &&
      (operation === undefined || this.operation === operation);
    if (!active()) throw new Error('CANCELLED');
    assertSynchronousEvmFeeGuard(this.host.assertCurrent);
    if (!active()) throw new Error('CANCELLED');
  }
  private publish(change: Partial<NativeInfrastructureSnapshot>) {
    if (this.disposed) return;
    this.snapshot = Object.freeze({ ...this.snapshot, ...change, revision: this.snapshot.revision + 1 });
    this.publishing = true;
    try {
      for (const listener of this.listeners) {
        try { listener(); } catch { /* Presentation cannot acquire transaction authority. */ }
      }
    } finally { this.publishing = false; }
  }
  private admit(revision: number): object | null {
    if (this.disposed || this.operation || this.publishing || revision !== this.snapshot.revision) return null;
    const operation = {};
    this.operation = operation;
    return operation;
  }
  private clearReview() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.prepared = null;
  }
  private failed(error: unknown, phase: 'failed' | 'unknown' = 'failed') {
    if (this.disposed) return;
    try { assertSynchronousEvmFeeGuard(this.host.assertCurrent); }
    catch { /* Let the owning host surface storage quarantine without acquiring authority. */ }
    this.clearReview();
    this.publish({ phase, feeReview: null, error: errorKey(error) });
  }
  private async observe(operation: object, preparing = false) {
    this.check(operation);
    const status = await this.host.observe(this.lifetime.signal);
    this.check(operation);
    const observation = Object.freeze({
      ...status.observation,
      contracts: Object.freeze(status.observation.contracts.map(contract => Object.freeze({ ...contract }))),
      missing: Object.freeze([...status.observation.missing]),
      create2Deployer: Object.freeze({ ...status.observation.create2Deployer }),
    }) as SmartAccountInfrastructureObservation;
    const captured = Object.freeze({ observation, pending: status.pending ? Object.freeze({ ...status.pending }) : null });
    this.publish({
      status: captured, error: null,
      phase: captured.pending ? 'pending' : preparing && observation.missing.length > 0 ? 'preparing' : observation.ready ? 'complete' : 'ready',
    });
    this.check(operation);
    return captured;
  }
  async refresh(revision: number): Promise<void> {
    const operation = this.admit(revision);
    if (!operation) return;
    this.clearReview();
    this.publish({ phase: 'loading', feeReview: null, error: null });
    try { await this.observe(operation); }
    catch (error) { this.failed(error, this.snapshot.status?.pending ? 'unknown' : 'failed'); }
    finally { if (this.operation === operation) this.operation = null; }
  }
  async reviewNext(revision: number): Promise<void> {
    // An uncertain attempt needs a separate explicit refresh to reconcile its journal.
    if (['pending', 'unknown', 'submitting'].includes(this.snapshot.phase)) return;
    const operation = this.admit(revision);
    if (!operation) return;
    this.clearReview();
    this.publish({ phase: 'preparing', feeReview: null, error: null });
    try {
      const status = await this.observe(operation, true);
      if (status.pending) return;
      const contract = PALI_INFRASTRUCTURE_METADATA.find(entry =>
        status.observation.missing.includes(entry.id) &&
        status.observation.contracts.some(observed => observed.id === entry.id && !observed.deployed));
      if (!contract) return;
      this.check(operation);
      if (!status.observation.create2Deployer.deployed || contract.externallyDeployed)
        throw new Error('Infrastructure deployment unavailable');
      const prepared = await this.host.prepare(contract.id, this.lifetime.signal);
      this.check(operation);
      if (!Number.isFinite(prepared.expiresAtMonotonicMilliseconds) || prepared.expiresAtMonotonicMilliseconds <= this.now())
        throw new Error('Review expired');
      if (this.submitted.has(prepared)) throw new Error('Infrastructure quote already consumed');
      this.prepared = prepared;
      const id = this.snapshot.revision + 1;
      const expire = () => {
        if (this.disposed || this.prepared !== prepared || this.snapshot.feeReview?.id !== id) return;
        const remaining = prepared.expiresAtMonotonicMilliseconds - this.now();
        if (remaining > 0) { this.timer = setTimeout(expire, Math.min(remaining, 2147483647)); return; }
        this.clearReview();
        this.publish({ phase: status.observation.ready ? 'complete' : 'ready', feeReview: null, error: 'mobile.infrastructure.reviewExpired' });
      };
      this.publish({
        phase: 'review', error: null,
        feeReview: Object.freeze({
          id,
          contract: Object.freeze({ id: contract.id, address: contract.address, displayName: contract.displayName, optional: Boolean(contract.optional) }),
          transaction: prepared.transaction,
          maximumFeeUnits: prepared.maximumFeeUnits,
          maximumTotalUnits: prepared.maximumTotalUnits,
          expiresAtMonotonicMilliseconds: prepared.expiresAtMonotonicMilliseconds,
        }),
      });
      this.check(operation);
      this.timer = setTimeout(expire, Math.min(prepared.expiresAtMonotonicMilliseconds - this.now(), 2147483647));
    } catch (error) { this.failed(error); }
    finally { if (this.operation === operation) this.operation = null; }
  }
  async confirm(reviewId: number): Promise<void> {
    if (this.snapshot.phase !== 'review' || this.snapshot.feeReview?.id !== reviewId || !this.prepared) return;
    const operation = this.admit(this.snapshot.revision);
    if (!operation) return;
    const prepared = this.prepared;
    const contractId = this.snapshot.feeReview.contract.id;
    this.clearReview();
    let entered = false;
    let broadcast = false;
    try {
      this.check(operation);
      if (prepared.expiresAtMonotonicMilliseconds <= this.now()) {
        this.publish({ phase: this.snapshot.status?.observation.ready ? 'complete' : 'ready', feeReview: null, error: 'mobile.infrastructure.reviewExpired' });
        return;
      }
      this.submitted.add(prepared);
      this.publish({ phase: 'submitting', feeReview: null, error: null });
      this.check(operation);
      entered = true;
      const hash = await prepared.submit(
        () => this.check(operation),
        hash => {
          this.check(operation);
          broadcast = true;
          this.publish({ status: this.pendingStatus(contractId, hash) });
        },
        { kind: 'transaction' }
      );
      this.check(operation);
      this.publish({ phase: 'pending', status: this.pendingStatus(contractId, hash) });
    } catch (error) {
      if (this.disposed) return;
      const failure = this.host.submissionFailure(error);
      const uncertain = entered && (broadcast || failure?.transactionNotBroadcast !== true);
      if (uncertain) this.publish({ status: this.pendingStatus(contractId, failure?.signedTransactionHash ?? this.snapshot.status?.pending?.transactionHash ?? null) });
      this.failed(error, uncertain ? 'unknown' : 'failed');
    } finally { if (this.operation === operation) this.operation = null; }
  }
  private pendingStatus(contractId: PaliInfrastructureContractId, transactionHash: string | null): NativeInfrastructureStatus | null {
    return this.snapshot.status ? Object.freeze({ ...this.snapshot.status, pending: Object.freeze({ contractId, transactionHash }) }) : null;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort();
    this.clearReview();
    this.snapshot = Object.freeze({ ...this.snapshot, feeReview: null, revision: this.snapshot.revision + 1 });
    this.listeners.clear();
    this.parent.removeEventListener('abort', this.retire);
    this.host.dispose();
  }
}
