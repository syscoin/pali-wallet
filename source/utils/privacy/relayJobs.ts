import { AbiCoder, keccak256 } from 'ethers';

import { getPrivacyPool } from './registry';
import { validatePrivacyRelayerEndpoint } from './relayers';
import type { PrivacyPoolId } from './types';

export type PrivacyRelayerJobState =
  | 'QUEUED'
  | 'ACCEPTED'
  | 'SENT'
  | 'MINED'
  | 'RESUBMITTED'
  | 'CONFIRMED'
  | 'FAILED';
export interface IPrivacyRelayerJobReference {
  endpoint: string;
  inputHash: string;
  jobId: string;
  poolId: PrivacyPoolId;
  proofHash: string;
}
export interface IPrivacyRelayerJobObservation {
  claimedStatus: PrivacyRelayerJobState;
  jobId: string;
  transactionHash?: string;
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORD = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PROOF = /^0x[0-9a-fA-F]{512}$/;
const STATES = new Set<PrivacyRelayerJobState>([
  'QUEUED',
  'ACCEPTED',
  'SENT',
  'MINED',
  'RESUBMITTED',
  'CONFIRMED',
  'FAILED',
]);
const invalid = () => new Error('privacy_relayer_job_invalid');

/**
 * Pinned wire schema: tornadocash/tornado-relayer@2247730603f2c249f90da0b07058325619435387
 * src/router.js, queue.js and constants.js. The endpoint reports these facts;
 * matching the saved proof/input hashes is not proof of on-chain inclusion.
 */
export async function readPrivacyRelayerJob(
  reference: IPrivacyRelayerJobReference,
  options: {
    assertCurrent: () => void;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
  }
): Promise<Readonly<IPrivacyRelayerJobObservation>> {
  const guard = () => {
    if (options.signal?.aborted) throw new Error('privacy_relayer_cancelled');
    try {
      const result: unknown = options.assertCurrent();
      if (result !== undefined) {
        if (result instanceof Promise) void result.catch(() => undefined);
        throw new Error();
      }
    } catch {
      throw new Error('privacy_vault_session_changed');
    }
  };
  guard();
  if (
    !reference ||
    !UUID.test(reference.jobId) ||
    !WORD.test(reference.inputHash) ||
    !WORD.test(reference.proofHash)
  )
    throw invalid();
  const fixed = Object.freeze({ ...reference });
  const origin = validatePrivacyRelayerEndpoint(fixed.endpoint),
    pool = getPrivacyPool(fixed.poolId);
  const url = `${origin}/v1/jobs/${fixed.jobId}`;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout>,
    remove = () => undefined;
  const interrupted = new Promise<never>((_, reject) => {
    const cancel = () => {
      abort.abort();
      reject(new Error('privacy_relayer_cancelled'));
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    remove = () => options.signal?.removeEventListener('abort', cancel);
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error('privacy_relayer_timeout'));
    }, 5000);
  });
  const run = async () => {
    const response = await (options.fetcher || fetch)(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: abort.signal,
    });
    guard();
    const length = response.headers.get('content-length');
    if (
      abort.signal.aborted ||
      response.status !== 200 ||
      response.redirected ||
      response.type === 'opaque' ||
      response.type === 'opaqueredirect' ||
      (response.url && response.url !== url) ||
      !response.body ||
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers.get('content-type') || ''
      ) ||
      (length && (!/^\d+$/.test(length) || Number(length) > 64 * 1024))
    )
      throw invalid();
    const reader = response.body.getReader(),
      decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0,
      text = '';
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        guard();
        if (abort.signal.aborted) throw invalid();
        size += next.value.byteLength;
        if (size > 64 * 1024) throw invalid();
        text += decoder.decode(next.value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    guard();
    const value = JSON.parse(text + decoder.decode());
    if (
      !value ||
      value.id !== fixed.jobId ||
      value.type !== 'TORNADO_WITHDRAW' ||
      !STATES.has(value.status) ||
      !PROOF.test(value.proof) ||
      typeof value.contract !== 'string' ||
      value.contract.toLowerCase() !== pool.address ||
      !Array.isArray(value.args) ||
      value.args.length !== 6 ||
      !value.args.every(
        (arg: unknown, index: number) =>
          typeof arg === 'string' &&
          (index === 2 || index === 3 ? ADDRESS : WORD).test(arg)
      )
    )
      throw invalid();
    if (
      keccak256(value.proof) !== fixed.proofHash.toLowerCase() ||
      keccak256(
        AbiCoder.defaultAbiCoder().encode(
          Array(6).fill('uint256'),
          value.args.map((arg: string) => BigInt(arg).toString())
        )
      ) !== fixed.inputHash.toLowerCase()
    )
      throw invalid();
    if (
      value.txHash !== undefined &&
      (typeof value.txHash !== 'string' || !WORD.test(value.txHash))
    )
      throw invalid();
    return Object.freeze({
      jobId: fixed.jobId,
      claimedStatus: value.status as PrivacyRelayerJobState,
      ...(value.txHash === undefined
        ? {}
        : { transactionHash: value.txHash.toLowerCase() }),
    });
  };
  try {
    return await Promise.race([run(), interrupted]);
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'privacy_relayer_job_invalid',
        'privacy_relayer_timeout',
        'privacy_relayer_cancelled',
        'privacy_vault_session_changed',
      ].includes(error.message)
    )
      throw error;
    throw new Error('privacy_relayer_job_unavailable');
  } finally {
    clearTimeout(timer!);
    remove();
  }
}
