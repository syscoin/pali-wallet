import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import type {
  RunSentryCrypto,
  SentryCryptoJob,
  SentryCryptoResult,
} from '../../../../source/wallet/sentryCryptoJobs.ts';

/** SDK jobs are bounded plain data; copy before a lazy loader can yield. */
function capture(job: SentryCryptoJob): SentryCryptoJob {
  let nodes = 0;
  let bytes = 0;
  const seen = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > 32_000 || depth > 24) throw new Error('INVALID_SENTRY_JOB');
    if (typeof value === 'string') {
      bytes += value.length;
      if (bytes > 4 * 1024 * 1024) throw new Error('INVALID_SENTRY_JOB');
      return value;
    }
    if (value === undefined || value === null || typeof value === 'boolean')
      return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || seen.has(value))
      throw new Error('INVALID_SENTRY_JOB');
    seen.add(value);
    const array = Array.isArray(value);
    if (
      !array &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      throw new Error('INVALID_SENTRY_JOB');
    const keys = Reflect.ownKeys(value);
    if (
      keys.length > 32_000 - nodes ||
      (array && keys.length !== value.length + 1)
    )
      throw new Error('INVALID_SENTRY_JOB');
    const result: Record<string, unknown> | unknown[] = array
      ? []
      : Object.create(null);
    for (const key of keys) {
      if (array && key === 'length') continue;
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== 'string' ||
        !property?.enumerable ||
        !('value' in property)
      )
        throw new Error('INVALID_SENTRY_JOB');
      Object.defineProperty(result, key, {
        value: copy(property.value, depth + 1),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    seen.delete(value);
    return result;
  };
  return copy(job, 0) as SentryCryptoJob;
}

/**
 * Execute the shared SDK dispatcher. SHAKE signing needs an independently
 * qualified off-thread executor: the native import validator is not a signer.
 */
export function createSentryCryptoExecutor(
  load: () => Promise<RunSentryCrypto>,
  isolated: RunSentryCrypto | null
): RunSentryCrypto {
  if (
    typeof load !== 'function' ||
    (isolated !== null && typeof isolated !== 'function')
  )
    throw new Error('SENTRY_EXECUTION_FAILED');
  let execution: Promise<RunSentryCrypto> | undefined;
  return async <T extends SentryCryptoResult>(
    input: SentryCryptoJob,
    assertCurrent: () => void
  ): Promise<T> => {
    const check = () => assertSynchronousEvmFeeGuard(assertCurrent);
    check();
    let job: SentryCryptoJob | undefined;
    try {
      job = capture(input);
      const needsIsolation =
        (job.type === 'import' && job.scheme === 'slh-dsa-shake-128s') ||
        ('key' in job && job.key.scheme === 'slh-dsa-shake-128s') ||
        ('context' in job && job.context.chain.era === 'pq-v4');
      let execute: RunSentryCrypto;
      if (needsIsolation) {
        if (isolated === null)
          throw new Error('SENTRY_SHAKE_EXECUTION_UNAVAILABLE');
        execute = isolated;
      } else {
        execution ??= load();
        execute = await execution;
      }
      check();
      if (
        !needsIsolation &&
        (job.type === 'signManagement' || job.type === 'verifyFee')
      ) {
        // Legacy preparation can already contain PQ authority slots. Use the
        // SDK review rather than infer a signature scheme from transaction bytes.
        const review = await execute(
          {
            type: 'reviewOperation',
            request: job.request,
            context: job.context,
          },
          check
        );
        check();
        if (
          'authorizations' in review &&
          review.authorizations.some(
            (auth) => auth.scheme === 'slh-dsa-shake-128s'
          )
        ) {
          if (isolated === null)
            throw new Error('SENTRY_SHAKE_EXECUTION_UNAVAILABLE');
          execute = isolated;
        }
      }
      // Never race this work against cancellation: custody remains admitted
      // until started SDK work has settled, and stale results cannot escape.
      const result = await execute<T>(job, check);
      check();
      return result;
    } catch (error) {
      check();
      if (
        error instanceof Error &&
        error.message === 'SENTRY_SHAKE_EXECUTION_UNAVAILABLE'
      )
        throw error;
      throw new Error('SENTRY_EXECUTION_FAILED');
    } finally {
      if (job && 'key' in job) job.key.secretKey = '';
      if (job?.type === 'import') job.secretKey = '';
    }
  };
}
