import { createInfrastructureJournal, type InfrastructureJournalEntry, type InfrastructureNetworkContext } from '../../../../source/wallet/infrastructureJournal.ts';
import { buildInfrastructureDeploymentCommand, settleInfrastructurePending } from '../../../../source/utils/smartAccount/infrastructureActions.ts';
import type { PaliInfrastructureContractId } from '../../../../source/utils/smartAccount/deploymentMetadata.ts';
import type { SmartAccountInfrastructureObservation } from '../../../../source/utils/smartAccount/infrastructureObservation.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import type { NativePreparedConnectionTransaction } from '../connections/transactionRuntime.ts';
import { NativeInfrastructureController, type NativeInfrastructureStatus } from '../smartAccount/infrastructure.ts';
import type { NativeNetworkRegistration } from './networkContext.ts';
import type { NativeGuardianRecoveryAccountRef, NativeInfrastructurePending } from './walletCatalogue.ts';

/** Constructor-trusted private ports. A screen never receives a journal or owner. */
export type NativeInfrastructureOwner = Readonly<{
  network: NativeNetworkRegistration;
  payer: NativeGuardianRecoveryAccountRef & Readonly<{ label: string }>;
  admit<T>(work: () => Promise<T>): Promise<T>;
  /** Exact admitted pre-signer cleanup; retirement never grants generic journal authority. */
  settleUnsent(attemptId: string): Promise<void>;
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
    open(owner: NativeInfrastructureOwner, parent: AbortSignal) {
      if (typeof owner.admit !== 'function' || typeof owner.settleUnsent !== 'function')
        throw new Error('Infrastructure submission lifecycle ports are required');
      const lifetime = new AbortController();
      const check = () => {
        if (parent.aborted || lifetime.signal.aborted) throw cancelled();
        assertSynchronousEvmFeeGuard(owner.assertCurrent);
      };
      check();
      const context = Object.freeze({ chainId: Number(owner.network.chainId), url: owner.network.rpcUrl });
      owners.set(context, { owner, check });
      let latest: NativeInfrastructureStatus | null = null;
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
      return new NativeInfrastructureController({
        networkLabel: owner.network.name, currencySymbol: owner.network.symbol,
        payerLabel: owner.payer.label, payerAddress: owner.payer.address,
        assertCurrent: check, dispose: () => { lifetime.abort(); owners.delete(context); }, observe,
        submissionFailure: error => (error instanceof Error ? failures.get(error) : undefined) ?? owner.submissionFailure(error),
        async prepare(contractId, signal) {
          // The private controller refreshes immediately before requesting this quote.
          const status = latest; latest = null;
          check();
          if (!status || status.pending || !status.observation.create2Deployer.deployed ||
              status.observation.contracts.find(contract => !contract.deployed)?.id !== contractId)
            throw new Error('Infrastructure status changed');
          // Deployment bytecode is loaded only for a requested deployment review.
          const { getPaliInfrastructureContracts } = await import('../../../../source/utils/smartAccount/deployment.ts');
          check();
          const contract = getPaliInfrastructureContracts(Number(owner.network.chainId)).find(contract => contract.id === contractId);
          if (!contract) throw cancelled();
          const command = buildInfrastructureDeploymentCommand({ contract, chainId: Number(owner.network.chainId), from: owner.payer.address, nonce: null });
          const attemptId = owner.randomId();
          let attempt: InfrastructureJournalEntry | null = null;
          let signerEntered = false;
          const validateAuthority = async () => {
            check();
            if (!attempt || owner.pending()?.entry.attemptId !== attempt.attemptId) throw cancelled();
            signerEntered = true;
          };
          const prepared = await owner.prepare(command, signal, validateAuthority, Object.freeze({ contractId, attemptId }));
          check();
          let consumed = false;
          return Object.freeze({
            ...prepared,
            submit(assertCurrent, onBroadcast, submission) {
              return owner.admit(async () => {
                check(); assertSynchronousEvmFeeGuard(assertCurrent);
                if (consumed || submission.kind !== 'transaction') throw cancelled();
                consumed = true;
                // The shared planner's reviewed nonce is authoritative; no second allocator.
                const nonce = Number(prepared.transaction.nonce);
                if (!Number.isSafeInteger(nonce) || nonce < 0) throw cancelled();
                attempt = Object.freeze({ attemptId, contractId, nonce,
                  payerAddress: owner.payer.address, rpcUrl: owner.network.rpcUrl });
                let attemptedHash: string | undefined;
                try {
                  await journal.write(context, attempt);
                  check(); assertSynchronousEvmFeeGuard(assertCurrent);
                  const hash = await prepared.submit(assertCurrent, hash => {
                    attemptedHash = hash; onBroadcast(hash);
                  }, submission);
                  check();
                  await journal.write(context, { ...attempt, transactionHash: hash });
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
                    try { await journal.clear(context, attempt, check); }
                    catch (cleanupError) { throw submissionError(cleanupError, { transactionNotBroadcast: false, ...(failure.signedTransactionHash ? { signedTransactionHash: failure.signedTransactionHash } : {}) }); }
                    throw submissionError(error, failure);
                  }
                  if (attemptedHash || failure?.signedTransactionHash) {
                    await journal.write(context, { ...attempt, transactionHash: attemptedHash ?? failure?.signedTransactionHash }).catch(() => undefined);
                  }
                  // A failed/retired acknowledgement never releases an uncertain attempt.
                  const hash = attemptedHash ?? failure?.signedTransactionHash;
                  throw submissionError(error, { transactionNotBroadcast: false, ...(hash ? { signedTransactionHash: hash } : {}) });
                }
              });
            },
          });
        },
      }, parent);
    },
  });
}
