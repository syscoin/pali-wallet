import { createInfrastructureJournal, type InfrastructureJournalEntry, type InfrastructureNetworkContext } from '../../../../source/wallet/infrastructureJournal.ts';
import { buildInfrastructureDeploymentCommand, settleInfrastructurePending } from '../../../../source/utils/smartAccount/infrastructureActions.ts';
import type { PaliInfrastructureContractId } from '../../../../source/utils/smartAccount/deploymentMetadata.ts';
import type { SmartAccountInfrastructureObservation } from '../../../../source/utils/smartAccount/infrastructureObservation.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import type { NativePreparedConnectionTransaction } from '../connections/transactionRuntime.ts';
import { NativeInfrastructureController, type NativeInfrastructureStatus } from '../smartAccount/infrastructure.ts';
import type { NativeNetworkRegistration } from './networkContext.ts';
import type { NativeGuardianRecoveryAccountRef, NativeInfrastructurePending } from './walletCatalogue.ts';
import { captureNativeSigningContinuation, type NativeSigningHandoff } from '../connections/signingHandoff.ts';
import { serializePreparedEvmTransaction, snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { toQuantity } from 'ethers/utils';

export type NativeInfrastructureHandoffCapture = Readonly<{
  contractId:PaliInfrastructureContractId;attemptId:string;transaction:NativePreparedConnectionTransaction['transaction'];
  unsignedTransaction:string;expiresAtMonotonicMilliseconds:number;expiresAt:number;
}>;
export type NativeInfrastructureOrigin = Readonly<{kind:'new'} | {kind:'suite-resume';handoff:NativeSigningHandoff}>;
const ownerBinding = (owner: NativeInfrastructureOwner) => JSON.stringify({
  network:[owner.network.id,owner.network.chainId,owner.network.registrationHash,owner.network.rpcUrl],
  payer:[owner.payer.id,owner.payer.address.toLowerCase(),owner.payer.xpub.toLowerCase()],
});
class InfrastructureContinuation {
  readonly attempt: InfrastructureJournalEntry & Readonly<{attemptId:string;nonce:number;payerAddress:string;rpcUrl:string}>;
  readonly transaction: NativePreparedConnectionTransaction['transaction'];
  readonly unsignedTransaction: string;
  readonly expiresAtMonotonicMilliseconds: number;
  readonly expiresAt: number;
  private readonly binding: string;
  private dead = false;
  private entered = false;
  constructor(owner:NativeInfrastructureOwner,capture:NativeInfrastructureHandoffCapture) {
    const nonce = Number(capture.transaction.nonce);
    if (!Number.isSafeInteger(nonce) || nonce < 0 || serializePreparedEvmTransaction(capture.transaction) !== capture.unsignedTransaction)
      throw new Error('Invalid infrastructure continuation');
    this.attempt = Object.freeze({attemptId:capture.attemptId,contractId:capture.contractId,nonce,payerAddress:owner.payer.address,rpcUrl:owner.network.rpcUrl});
    this.transaction = snapshotPreparedEvmTransaction(capture.transaction);
    this.unsignedTransaction = capture.unsignedTransaction;
    this.expiresAtMonotonicMilliseconds = capture.expiresAtMonotonicMilliseconds;
    this.expiresAt = capture.expiresAt;
    this.binding = ownerBinding(owner);
  }
  get retired() { return this.dead; }
  get signerEntered() { return this.entered; }
  markSignerEntered() { this.entered = true; }
  retire() { this.dead = true; }
  assertResumeCurrent() {
    if (this.dead || Date.now() >= this.expiresAt || performance.now() >= this.expiresAtMonotonicMilliseconds)
      throw new Error('Infrastructure continuation expired');
  }
  assertOwner(owner:NativeInfrastructureOwner) {
    this.assertResumeCurrent();
    if (!this.entered || ownerBinding(owner) !== this.binding) throw new Error('Infrastructure continuation changed');
  }
}
export type NativeInfrastructureContinuation = Readonly<Pick<InfrastructureContinuation,
  'attempt'|'transaction'|'unsignedTransaction'|'expiresAtMonotonicMilliseconds'|'expiresAt'|'retired'|'signerEntered'|'assertResumeCurrent'>>;
/** The existing handoff owner must transfer the original private object; it cannot be recreated from a return URI. */
export function getNativeInfrastructureContinuation(handoff:NativeSigningHandoff): NativeInfrastructureContinuation {
  const continuation = captureNativeSigningContinuation(handoff, (): InfrastructureContinuation => { throw new Error('Infrastructure continuation missing'); });
  if (!(continuation instanceof InfrastructureContinuation)) throw new Error('Infrastructure continuation missing');
  continuation.assertResumeCurrent();
  return continuation;
}

/** Constructor-trusted private ports. A screen never receives a journal or owner. */
export type NativeInfrastructureOwner = Readonly<{
  network: NativeNetworkRegistration;
  payer: NativeGuardianRecoveryAccountRef & Readonly<{ label: string }>;
  admit<T>(work: () => Promise<T>): Promise<T>;
  /** Exact admitted pre-signer cleanup; retirement never grants generic journal authority. */
  settleUnsent(attemptId: string): Promise<void>;
  createSigningHandoff(capture:NativeInfrastructureHandoffCapture): NativeSigningHandoff | null;
  background():void;
  dispose():void;
  assertCurrent(): void;
  pending(): NativeInfrastructurePending | undefined;
  commit(pending: NativeInfrastructurePending | null, expectedAttemptId: string | null): Promise<void>;
  observe(signal: AbortSignal): Promise<SmartAccountInfrastructureObservation>;
  readReceipt(hash: string, signal: AbortSignal): Promise<unknown>;
  readLatestNonce(address: string, signal: AbortSignal): Promise<unknown>;
  prepare(request: Readonly<Record<string, unknown>>, signal: AbortSignal,
    validateAuthority: () => Promise<void>, deployment: Readonly<{ contractId: PaliInfrastructureContractId; attemptId: string }>): Promise<NativePreparedConnectionTransaction>;
  randomId(): string;
  submissionFailure(error: unknown): Readonly<{ transactionNotBroadcast: boolean; signedTransactionHash?: string }> | undefined;
}>;

const cancelled = () => new Error('CANCELLED');

/** One journal per fixed catalogue owner. Context capabilities never enter UI DTOs. */
export function createNativeInfrastructure() {
  type Failure = Readonly<{ transactionNotBroadcast: boolean; signedTransactionHash?: string }>;
  const failures = new WeakMap<Error, Failure>();
  const submissionError = (cause: unknown, failure: Failure) => {
    const error = new Error(cause instanceof Error ? cause.message : 'Infrastructure submission failed', { cause });
    failures.set(error, Object.freeze(failure));
    return error;
  };
  const owners = new WeakMap<InfrastructureNetworkContext, { owner: NativeInfrastructureOwner; check(): void }>();
  const binding = (context: InfrastructureNetworkContext) => {
    const current = owners.get(context);
    if (!current) throw cancelled();
    current.check();
    return current;
  };
  const journal = createInfrastructureJournal({
    async read(context, assertCurrent) {
      const current = binding(context);
      if (assertCurrent !== null) assertSynchronousEvmFeeGuard(assertCurrent);
      const result = current.owner.pending()?.entry;
      current.check();
      return result;
    },
    async write(context, entry) {
      const { owner, check } = binding(context);
      const previous = owner.pending();
      if (entry === null) {
        if (!previous) return;
        await owner.commit(null, previous.entry.attemptId);
      } else {
        if (!entry.attemptId || entry.nonce === undefined ||
            entry.payerAddress?.toLowerCase() !== owner.payer.address.toLowerCase() || entry.rpcUrl !== owner.network.rpcUrl)
          throw cancelled();
        const pending: NativeInfrastructurePending = Object.freeze({
          chainId: owner.network.chainId, networkId: owner.network.id, registrationHash: owner.network.registrationHash,
          payer: Object.freeze({ id: owner.payer.id, address: owner.payer.address, xpub: owner.payer.xpub }),
          entry: Object.freeze({ ...entry, attemptId: entry.attemptId, nonce: entry.nonce,
            payerAddress: owner.payer.address, rpcUrl: owner.network.rpcUrl }),
        });
        await owner.commit(pending, previous?.entry.attemptId ?? null);
      }
      check();
    },
  });
  return Object.freeze({
    open(owner: NativeInfrastructureOwner, parent: AbortSignal, origin:NativeInfrastructureOrigin) {
      if (!origin || (origin.kind !== 'new' && origin.kind !== 'suite-resume')) throw new Error('Infrastructure origin required');
      if (typeof owner.admit !== 'function' || typeof owner.settleUnsent !== 'function' ||
          typeof owner.createSigningHandoff !== 'function' || typeof owner.background !== 'function' || typeof owner.dispose !== 'function')
        throw new Error('Infrastructure submission lifecycle ports are required');
      const lifetime = new AbortController();
      const check = () => {
        if (parent.aborted || lifetime.signal.aborted) throw cancelled();
        assertSynchronousEvmFeeGuard(owner.assertCurrent);
      };
      check();
      const resumed = origin.kind === 'suite-resume' ? getNativeInfrastructureContinuation(origin.handoff) : null;
      if (resumed !== null && !(resumed instanceof InfrastructureContinuation)) throw cancelled();
      resumed?.assertOwner(owner);
      const context = Object.freeze({ chainId: Number(owner.network.chainId), url: owner.network.rpcUrl });
      owners.set(context, { owner, check });
      let latest: NativeInfrastructureStatus | null = null;
      const matchesPending = (attempt: InfrastructureContinuation['attempt']): NativeInfrastructurePending => {
        check();
        const pending = owner.pending();
        if (!pending || pending.chainId !== owner.network.chainId || pending.networkId !== owner.network.id ||
            pending.registrationHash !== owner.network.registrationHash || pending.payer.id !== owner.payer.id ||
            pending.payer.address !== owner.payer.address || pending.payer.xpub !== owner.payer.xpub ||
            pending.entry.attemptId !== attempt.attemptId || pending.entry.contractId !== attempt.contractId ||
            pending.entry.nonce !== attempt.nonce || pending.entry.payerAddress !== attempt.payerAddress ||
            pending.entry.rpcUrl !== attempt.rpcUrl || pending.entry.transactionHash !== undefined)
          throw new Error('Infrastructure continuation reservation changed');
        check();
        return pending;
      };
      const statusFrom = (observation: SmartAccountInfrastructureObservation, pending: NativeInfrastructurePending | undefined): NativeInfrastructureStatus =>
        Object.freeze({ observation, pending: pending ? Object.freeze({
          contractId: pending.entry.contractId, transactionHash: pending.entry.transactionHash ?? null,
        }) : null });
      const observe = async (signal: AbortSignal) => {
        latest = null;
        check();
        const observed = await journal.read(context, check);
        const observation = await owner.observe(signal);
        check();
        if (observed && await settleInfrastructurePending({
          context, entry: observed, status: observation, ports: {
            readReceipt: hash => owner.readReceipt(hash, signal),
            readLatestNonce: address => owner.readLatestNonce(address, signal),
          },
        }) === 'settled') {
          check();
          await journal.clear(context, observed, check);
          check();
        }
        const pending = await journal.read(context, check);
        check();
        latest = Object.freeze({ observation, pending: pending ? Object.freeze({
          contractId: pending.contractId, transactionHash: pending.transactionHash ?? null,
        }) : null });
        return latest;
      };
      const prepare = async (contractId: PaliInfrastructureContractId, signal: AbortSignal,
        continuation: InfrastructureContinuation | null): Promise<NativePreparedConnectionTransaction> => {
        check();
        if (signal.aborted) throw cancelled();
        continuation?.assertOwner(owner);
        if (continuation) matchesPending(continuation.attempt);
        // Canonical calldata is rebuilt even when an exact Suite transcript is retained.
        const { getPaliInfrastructureContracts } = await import('../../../../source/utils/smartAccount/deployment.ts');
        check();
        continuation?.assertOwner(owner);
        const contract = getPaliInfrastructureContracts(Number(owner.network.chainId)).find(entry => entry.id === contractId);
        if (!contract) throw cancelled();
        const command = buildInfrastructureDeploymentCommand({ contract, chainId: Number(owner.network.chainId), from: owner.payer.address, nonce: null });
        const saved = continuation?.transaction;
        const request = saved ? Object.freeze({
          ...command,
          gas: toQuantity(saved.gasLimit), type: toQuantity(saved.type),
          ...(saved.type === 0 ? { gasPrice: toQuantity(saved.gasPrice) } : {
            maxFeePerGas: toQuantity(saved.maxFeePerGas), maxPriorityFeePerGas: toQuantity(saved.maxPriorityFeePerGas),
            accessList: saved.accessList,
          }),
          // Omit nonce: the existing automatic planner must independently reproduce it.
        }) : command;
        const attemptId = continuation?.attempt.attemptId ?? owner.randomId();
        let attempt: InfrastructureContinuation['attempt'] | null = continuation?.attempt ?? null;
        // Historical signer entry survives departure. Early resumed quote failures
        // must never acquire the original pre-signer cleanup lease.
        let signerEntered = continuation?.signerEntered ?? false;
        let capability = continuation;
        const validateAuthority = async () => {
          check();
          if (!attempt) throw cancelled();
          matchesPending(attempt);
          signerEntered = true;
          capability?.markSignerEntered();
        };
        const prepared = await owner.prepare(request, signal, validateAuthority, Object.freeze({ contractId, attemptId }));
        check();
        if (signal.aborted) throw cancelled();
        continuation?.assertOwner(owner);
        if (continuation) matchesPending(continuation.attempt);
        const unsignedTransaction = serializePreparedEvmTransaction(prepared.transaction);
        if (continuation && unsignedTransaction !== continuation.unsignedTransaction)
          throw new Error('Infrastructure continuation transaction changed');
        const monotonicNow = performance.now(), wallNow = Date.now();
        const expiresAtMonotonicMilliseconds = Math.min(prepared.expiresAtMonotonicMilliseconds,
          continuation?.expiresAtMonotonicMilliseconds ?? Infinity,
          continuation ? monotonicNow + continuation.expiresAt - wallNow : Infinity);
        if (!Number.isFinite(expiresAtMonotonicMilliseconds) || expiresAtMonotonicMilliseconds <= monotonicNow)
          throw new Error('Review expired');
        const expiresAt = Math.min(continuation?.expiresAt ?? Infinity,
          Math.floor(wallNow + expiresAtMonotonicMilliseconds - monotonicNow));
        const capture: NativeInfrastructureHandoffCapture = Object.freeze({ contractId, attemptId,
          transaction: prepared.transaction, unsignedTransaction, expiresAtMonotonicMilliseconds, expiresAt });
        const handoff = owner.createSigningHandoff(capture);
        check();
        if (continuation) {
          if (origin.kind !== 'suite-resume' || handoff !== origin.handoff) throw cancelled();
          const existing = captureNativeSigningContinuation(handoff, (): InfrastructureContinuation => { throw new Error('Infrastructure continuation missing'); });
          if (existing !== continuation) throw cancelled();
          continuation.assertOwner(owner);
          matchesPending(continuation.attempt);
        } else if (handoff) {
          let created: InfrastructureContinuation | undefined;
          const existing = captureNativeSigningContinuation(handoff, () => (created = new InfrastructureContinuation(owner, capture)));
          if (!created || existing !== created) throw new Error('Infrastructure continuation already exists');
          capability = created;
        }
        const nonce = Number(prepared.transaction.nonce);
        if (!Number.isSafeInteger(nonce) || nonce < 0) throw cancelled();
        attempt ??= Object.freeze({ attemptId, contractId, nonce, payerAddress: owner.payer.address, rpcUrl: owner.network.rpcUrl });
        const issuedAttempt = attempt;
        let consumed = false;
        return Object.freeze({
          ...prepared, expiresAtMonotonicMilliseconds,
          submit(assertCurrent: () => void, onBroadcast: (hash: string) => void,
            submission: Parameters<NativePreparedConnectionTransaction['submit']>[2]) {
            const approvalCurrent = () => {
              check(); assertSynchronousEvmFeeGuard(assertCurrent);
              if (signal.aborted) throw cancelled();
              if (performance.now() >= expiresAtMonotonicMilliseconds || capability && Date.now() >= expiresAt) throw new Error('Review expired');
            };
            // Revoke before any admitted work or callback can reenter this capability.
            approvalCurrent(); capability?.assertResumeCurrent();
            if (consumed || submission.kind !== 'transaction') throw cancelled();
            consumed = true;
            return owner.admit(async () => {
              let attemptedHash: string | undefined;
              try {
                approvalCurrent();
                if (continuation) matchesPending(issuedAttempt);
                else await journal.write(context, issuedAttempt);
                approvalCurrent();
                const hash = await prepared.submit(approvalCurrent, hash => {
                  attemptedHash = hash; onBroadcast(hash);
                }, submission);
                check();
                await journal.write(context, { ...issuedAttempt, transactionHash: hash });
                check();
                return hash;
              } catch (error) {
                const failure = owner.submissionFailure(error);
                if (!signerEntered) {
                  try { await owner.settleUnsent(attemptId); }
                  catch (cleanupError) { throw submissionError(cleanupError, { transactionNotBroadcast: false }); }
                  throw submissionError(error, { transactionNotBroadcast: true });
                }
                if (failure?.transactionNotBroadcast === true) {
                  // SDK-proven rejection may release only through the still-current route.
                  try { await journal.clear(context, issuedAttempt, check); }
                  catch (cleanupError) { throw submissionError(cleanupError, { transactionNotBroadcast: false, ...(failure.signedTransactionHash ? { signedTransactionHash: failure.signedTransactionHash } : {}) }); }
                  throw submissionError(error, failure);
                }
                if (attemptedHash || failure?.signedTransactionHash) {
                  await journal.write(context, { ...issuedAttempt, transactionHash: attemptedHash ?? failure?.signedTransactionHash }).catch(() => undefined);
                }
                // A failed/retired acknowledgement never releases an uncertain attempt.
                const hash = attemptedHash ?? failure?.signedTransactionHash;
                throw submissionError(error, { transactionNotBroadcast: false, ...(hash ? { signedTransactionHash: hash } : {}) });
              }
            });
          },
        });
      };
      const controllerOrigin = origin.kind === 'suite-resume' ? Object.freeze({ kind: 'suite-resume' as const, id: origin.handoff.id,
        async prepare(signal: AbortSignal) {
          check(); resumed!.assertOwner(owner);
          matchesPending(resumed!.attempt);
          const observation = await owner.observe(signal);
          check(); resumed!.assertOwner(owner);
          const pending = matchesPending(resumed!.attempt);
          if (!observation.create2Deployer.deployed || observation.contracts.find(contract => !contract.deployed)?.id !== resumed!.attempt.contractId)
            throw new Error('Infrastructure continuation status changed');
          const prepared = await prepare(resumed!.attempt.contractId, signal, resumed!);
          check(); resumed!.assertOwner(owner);
          matchesPending(resumed!.attempt);
          return Object.freeze({ status: statusFrom(observation, pending), contractId: resumed!.attempt.contractId, prepared });
        },
      }) : Object.freeze({ kind: 'new' as const });
      return new NativeInfrastructureController({
        origin: controllerOrigin,
        networkLabel: owner.network.name, currencySymbol: owner.network.symbol,
        payerLabel: owner.payer.label, payerAddress: owner.payer.address,
        assertCurrent: check, background: () => owner.background(),
        dispose() { lifetime.abort(); owners.delete(context); owner.dispose(); }, observe,
        submissionFailure: error => (error instanceof Error ? failures.get(error) : undefined) ?? owner.submissionFailure(error),
        async prepare(contractId, signal) {
          if (origin.kind !== 'new') throw cancelled();
          const status = latest; latest = null;
          check();
          if (!status || status.pending || !status.observation.create2Deployer.deployed ||
              status.observation.contracts.find(contract => !contract.deployed)?.id !== contractId)
            throw new Error('Infrastructure status changed');
          return prepare(contractId, signal, null);
        },
      }, parent);
    },
  });
}
