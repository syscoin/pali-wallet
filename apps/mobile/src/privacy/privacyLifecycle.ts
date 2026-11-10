import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';

type Owner = { retire(): Promise<void> };

/** Native privacy resources only. Retirement revokes first and then joins actual host cleanup. */
export function createNativePrivacyLifecycle() {
  let revision = 0;
  let retiring: Promise<void> | undefined;
  let failure: unknown;
  const owners = new Set<Owner>();
  const assertAvailable = () => {
    if (failure !== undefined) throw Error('privacy_cleanup_failed');
    if (retiring) throw Error('privacy_busy');
  };
  return Object.freeze({
    assertAvailable,
    open<T, Published>(external: AbortSignal, assertCurrent: () => void,
      create: (signal: AbortSignal, guard: () => void) => Promise<T>,
      dispose: (value: T) => void | Promise<void>,
      publish: (value: T, retire: () => Promise<void>) => Published): Promise<Published> {
      assertAvailable();
      if (owners.size >= 16) throw Error('privacy_busy');
      assertSynchronousEvmFeeGuard(assertCurrent);
      if (external.aborted) return Promise.reject(Error('privacy_cancelled'));
      const captured = revision, lifetime = new AbortController();
      const check = () => {
        assertSynchronousEvmFeeGuard(assertCurrent);
        if (captured !== revision || external.aborted || lifetime.signal.aborted) throw Error('privacy_cancelled');
      };
      const opening = Promise.resolve().then(() => { check(); return create(lifetime.signal, check); });
      let closing: Promise<void> | undefined;
      const owner: Owner = { retire() {
        if (closing) return closing;
        let resolve!: () => void, reject!: (error: unknown) => void;
        closing = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
        lifetime.abort(); external.removeEventListener('abort', abort);
        void opening.then(value => dispose(value), () => undefined).then(() => { owners.delete(owner); resolve(); }, error => {
          failure = error ?? Error('privacy_cleanup_failed'); reject(error);
        });
        void closing.catch(() => undefined);
        return closing;
      } };
      const abort = () => { void owner.retire().catch(() => undefined); };
      owners.add(owner); external.addEventListener('abort', abort, { once: true });
      if (external.aborted) abort();
      return opening.then(async value => {
        try { check(); return publish(value, owner.retire); }
        catch (error) { await owner.retire(); throw error; }
      }, async error => { await owner.retire(); throw error; });
    },
    invalidate(): Promise<void> {
      if (retiring) return retiring;
      let resolve!: () => void, reject!: (error: unknown) => void;
      const barrier = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
      retiring = barrier; revision++;
      const pending = [...owners].map(owner => owner.retire());
      void Promise.allSettled(pending).then(results => {
        const rejected = results.find(result => result.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
        if (failure !== undefined) throw failure;
      }).then(() => { if (retiring === barrier) retiring = undefined; resolve(); }, error => {
        if (retiring === barrier) retiring = undefined; reject(error);
      });
      void barrier.catch(() => undefined);
      return retiring;
    },
  });
}
