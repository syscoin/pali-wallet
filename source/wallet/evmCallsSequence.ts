import { normalizeDappCallsRequest } from '../shared/dappCalls.ts';
import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeApproval.ts';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from '../utils/evmTransactionContext.ts';

import type { DappCall } from '../shared/dappCalls.ts';

export type EoaCallsTransaction = Readonly<{
  chainId: number;
  data: string;
  from: string;
  nonce: number;
  to?: string;
  value: string;
}>;
export type EoaCallsFailure = Readonly<{
  cause: unknown;
  kind: 'destination' | 'submission' | 'persistence';
}>;
export type EoaCallsProgress = Readonly<{
  failure?: EoaCallsFailure;
  hash?: string;
  index: number;
  status: 'pending' | 'signing' | 'sending' | 'success' | 'error' | 'unknown';
}>;
export type EoaCallsCompletion = Readonly<{
  failed: boolean;
  hashes: readonly string[];
}>;
export type EoaCallsOutcome = EoaCallsCompletion &
  Readonly<{
    failure?: EoaCallsFailure;
    hash?: string;
    index?: number;
    status: 'finished' | 'retired' | 'unknown';
  }>;
export type EoaCallsPorts = Readonly<{
  assertCurrent(): void;
  begin(): Promise<string>;
  nonce(): Promise<number>;
  persistCompletion(value: EoaCallsCompletion): Promise<void>;
  persistHash(hash: string): Promise<void>;
  recordNotBroadcast(): Promise<boolean>;
  resolveAddress(call: DappCall): Promise<string | undefined>;
  send(
    transaction: EoaCallsTransaction,
    submissionId: string
  ): Promise<unknown>;
  update(value: EoaCallsProgress): void;
}>;

const readHash = (value: unknown): string | undefined =>
  typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value)
    ? value
    : undefined;
const completion = (
  failed: boolean,
  hashes: readonly string[]
): EoaCallsCompletion =>
  Object.freeze({ failed, hashes: Object.freeze([...hashes]) });

/** One reviewed request owns its acknowledged prefix and ordered retries. */
export function createEoaCallsSequence(input: unknown) {
  const request = normalizeDappCallsRequest(input);
  if (request.atomicRequired || !request.from || !request.chainId)
    throw new Error(
      'A sequential calls request requires its approved account and chain'
    );
  const from = request.from,
    chainId = Number(BigInt(request.chainId));
  const acknowledged = new Map<number, string>();
  let running = false,
    unknown = false;
  let pendingCompletion:
    | { persist: EoaCallsPorts['persistCompletion']; value: EoaCallsCompletion }
    | undefined;

  const retryCompletion = async (): Promise<void> => {
    const pending = pendingCompletion;
    if (!pending) return;
    await pending.persist(pending.value);
    if (pendingCompletion === pending) pendingCompletion = undefined;
  };

  const run = async (ports: EoaCallsPorts): Promise<EoaCallsOutcome> => {
    for (const name of [
      'assertCurrent',
      'begin',
      'nonce',
      'persistCompletion',
      'persistHash',
      'recordNotBroadcast',
      'resolveAddress',
      'send',
      'update',
    ] as const)
      if (typeof ports?.[name] !== 'function')
        throw new Error('Sequential calls require explicit host ports');
    if (running || pendingCompletion)
      throw new Error('Sequential calls are already awaiting completion');
    if (unknown)
      throw new Error('Sequential calls have an unresolved submission');
    const host = Object.freeze({
      assertCurrent: ports.assertCurrent.bind(ports),
      begin: ports.begin.bind(ports),
      nonce: ports.nonce.bind(ports),
      persistCompletion: ports.persistCompletion.bind(ports),
      persistHash: ports.persistHash.bind(ports),
      recordNotBroadcast: ports.recordNotBroadcast.bind(ports),
      resolveAddress: ports.resolveAddress.bind(ports),
      send: ports.send.bind(ports),
      update: ports.update.bind(ports),
    });
    const check = () => assertSynchronousEvmFeeGuard(host.assertCurrent);
    const isCurrent = () => {
      try {
        check();
        return true;
      } catch {
        return false;
      }
    };
    check();
    const indices = request.calls
      .map((_, index) => index)
      .filter((index) => !acknowledged.has(index));
    if (!indices.length)
      return { ...completion(false, []), status: 'finished' };
    running = true;
    try {
      let nonce = await host.nonce();
      check();
      if (!Number.isSafeInteger(nonce) || nonce < 0)
        throw new Error('Invalid starting nonce');
      for (const index of indices) host.update({ index, status: 'pending' });
      const hashes: string[] = [];
      let failed = false;
      for (const index of indices) {
        if (!isCurrent())
          return { ...completion(true, hashes), status: 'retired' };
        if (!Number.isSafeInteger(nonce) || nonce < 0)
          throw new Error('Invalid next nonce');
        let invoked = false,
          begun = false;
        let stage: EoaCallsFailure['kind'] = 'destination';
        host.update({ index, status: 'signing' });
        try {
          const call = request.calls[index]!;
          const to =
            call.to && /^0x[\da-f]{40}$/i.test(call.to)
              ? call.to
              : call.to
              ? await host.resolveAddress(call)
              : undefined;
          check();
          if (
            (call.to && to === undefined) ||
            (to !== undefined && !/^0x[\da-f]{40}$/i.test(to))
          )
            throw new Error('Invalid resolved call destination');
          const transaction: EoaCallsTransaction = Object.freeze({
            from,
            chainId,
            data: call.data,
            value: call.value,
            nonce,
            ...(to === undefined ? {} : { to }),
          });
          host.update({ index, status: 'sending' });
          stage = 'submission';
          const submissionId = await host.begin();
          begun = true;
          if (typeof submissionId !== 'string' || !submissionId)
            throw new Error('Missing calls submission identity');
          check();
          invoked = true;
          const response = await host.send(transaction, submissionId);
          const hash = readHash(
            response && typeof response === 'object' && 'hash' in response
              ? response.hash
              : response
          );
          if (!hash)
            throw new Error('The sender returned no valid transaction hash');
          acknowledged.set(index, hash);
          stage = 'persistence';
          // A known broadcast is retained even when presentation authority has ended.
          await host.persistHash(hash);
          hashes.push(hash);
          host.update({ index, status: 'success', hash });
          nonce++;
        } catch (cause) {
          const hash = readHash(
            cause && typeof cause === 'object' && 'transactionHash' in cause
              ? cause.transactionHash
              : undefined
          );
          if (invoked && hash && stage !== 'persistence') {
            acknowledged.set(index, hash);
            try {
              await host.persistHash(hash);
            } catch (error) {
              unknown = true;
              const failure = { kind: 'persistence' as const, cause: error };
              host.update({ index, status: 'unknown', hash, failure });
              return {
                ...completion(true, hashes),
                status: 'unknown',
                index,
                hash,
                failure,
              };
            }
            hashes.push(hash);
            host.update({ index, status: 'success', hash });
            nonce++;
            if (
              cause &&
              typeof cause === 'object' &&
              'message' in cause &&
              cause.message === EVM_TRANSACTION_CONTEXT_CHANGED
            ) {
              failed = index !== indices[indices.length - 1];
              break;
            }
            if (index !== indices[indices.length - 1] && !isCurrent())
              return { ...completion(true, hashes), status: 'retired' };
            continue;
          }
          const notBroadcast =
            cause &&
            typeof cause === 'object' &&
            'transactionNotBroadcast' in cause &&
            cause.transactionNotBroadcast === true;
          if (begun && (!invoked || notBroadcast))
            await host.recordNotBroadcast();
          unknown = stage === 'persistence' || (invoked && !notBroadcast);
          failed = true;
          const failure = Object.freeze({ kind: stage, cause });
          const knownHash = acknowledged.get(index);
          host.update({
            index,
            status: unknown ? 'unknown' : 'error',
            failure,
            ...(knownHash ? { hash: knownHash } : {}),
          });
          if (unknown)
            return {
              ...completion(true, hashes),
              status: 'unknown',
              index,
              hash: knownHash,
              failure,
            };
          if (!isCurrent())
            return { ...completion(true, hashes), status: 'retired' };
          break;
        }
      }
      const value = completion(failed, hashes);
      pendingCompletion = { value, persist: host.persistCompletion };
      await retryCompletion();
      return { ...value, status: 'finished' };
    } finally {
      running = false;
    }
  };

  return Object.freeze({ run, retryCompletion });
}
