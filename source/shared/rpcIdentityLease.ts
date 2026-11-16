/** A shared observation of endpoint identity, scoped by the host to one context. */
export function createRpcIdentityLease(
  verify: (signal: AbortSignal) => Promise<void>,
  now: () => number = () => performance.now()
) {
  const duration = 30_000;
  type Observation = {
    controller: AbortController;
    promise: Promise<void>;
    settled: boolean;
    users: number;
  };
  let validUntil = 0;
  let generation = 0;
  let pending: Observation | undefined;
  const active = new Set<Observation>();
  const invalidate = () => {
    generation++;
    validUntil = 0;
    active.forEach((observation) => observation.controller.abort());
    pending = undefined;
  };
  return {
    invalidate,
    async ensure(signal: AbortSignal, fresh = false): Promise<void> {
      const cancelled = () =>
        signal.reason instanceof Error
          ? signal.reason
          : Object.assign(new Error('RPC identity check cancelled'), {
              name: 'AbortError',
            });
      if (signal.aborted) throw cancelled();
      const remaining = validUntil - now();
      if (!fresh && remaining > 0 && remaining <= duration) return;
      if (fresh || !pending || pending.controller.signal.aborted) {
        if (fresh) generation++;
        validUntil = 0;
        const epoch = generation;
        const next: Observation = {
          controller: new AbortController(),
          promise: Promise.resolve(),
          users: 0,
          settled: false,
        };
        pending = next;
        active.add(next);
        next.promise = Promise.resolve()
          .then(() => {
            if (next.controller.signal.aborted) throw cancelled();
            return verify(next.controller.signal);
          })
          .then(() => {
            if (next.controller.signal.aborted) throw cancelled();
            if (epoch === generation) validUntil = now() + duration;
          })
          .finally(() => {
            next.settled = true;
            active.delete(next);
            if (pending === next) pending = undefined;
          });
      }
      const observed = pending;
      observed.users++;
      let abort: () => void;
      try {
        await new Promise<void>((resolve, reject) => {
          abort = () => reject(cancelled());
          signal.addEventListener('abort', abort, { once: true });
          observed.controller.signal.addEventListener('abort', abort, {
            once: true,
          });
          if (signal.aborted || observed.controller.signal.aborted) abort();
          observed.promise.then(resolve, reject);
        });
      } finally {
        signal.removeEventListener('abort', abort);
        observed.controller.signal.removeEventListener('abort', abort);
        if (--observed.users === 0 && !observed.settled) {
          observed.controller.abort();
          if (pending === observed) pending = undefined;
        }
      }
    },
  };
}
