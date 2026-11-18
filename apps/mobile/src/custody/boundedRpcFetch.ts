type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Keep physical response ownership through consumption or cancellation. */
export function createBoundedRpcFetch(fetcher: FetchLike): FetchLike {
  let active = 0;
  const queue: { run(): void; cancel(): void }[] = [];
  const aborted = () =>
    Object.assign(new Error('RPC request cancelled'), { name: 'AbortError' });
  const acquire = (signal: AbortSignal | null | undefined) =>
    new Promise<void>((resolve, reject) => {
      const ticket = {
        run() {
          signal?.removeEventListener('abort', ticket.cancel);
          active++;
          resolve();
        },
        cancel() {
          const index = queue.indexOf(ticket);
          if (index >= 0) queue.splice(index, 1);
          reject(aborted());
        },
      };
      if (signal?.aborted) ticket.cancel();
      else if (active < 4) ticket.run();
      else if (queue.length >= 16)
        reject(new Error('RPC request capacity exceeded'));
      else {
        queue.push(ticket);
        signal?.addEventListener('abort', ticket.cancel, { once: true });
      }
    });
  return async (url, init) => {
    await acquire(init.signal);
    let released = false;
    let abortResponse: (() => void) | undefined;
    const release = () => {
      if (released) return;
      released = true;
      if (abortResponse)
        init.signal?.removeEventListener('abort', abortResponse);
      active--;
      queue.shift()?.run();
    };
    try {
      if (init.signal?.aborted) throw aborted();
      const response = await fetcher(url, init);
      const body = response.body;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let text: Promise<string> | undefined,
        cancellation: Promise<void> | undefined;
      const consumeText = () =>
        (text ??= response.text().then(
          async (value) => {
            if (body && cancellation) await cancellation;
            else release();
            if (init.signal?.aborted) throw aborted();
            return value;
          },
          async (error) => {
            try {
              if (body) await cancel();
            } finally {
              release();
            }
            throw error;
          }
        ));
      const cancel = (reason?: unknown) =>
        (cancellation ??= (async () => {
          try {
            if (reader) await reader.cancel(reason);
            else if (body) await body.cancel(reason);
            else await consumeText();
          } finally {
            release();
          }
        })());
      abortResponse = () => {
        void cancel(init.signal?.reason).catch(() => undefined);
      };
      init.signal?.addEventListener('abort', abortResponse, { once: true });
      if (init.signal?.aborted) {
        try {
          await cancel();
        } catch {
          /* Preserve cancellation. */
        }
        throw aborted();
      }
      const wrappedBody = {
        cancel,
        ...(typeof body?.getReader === 'function'
          ? {
              getReader() {
                if (init.signal?.aborted) throw aborted();
                try {
                  reader = body.getReader();
                } catch (error) {
                  void cancel().catch(() => undefined);
                  throw error;
                }
                const acquiredReader = reader;
                return {
                  async read() {
                    try {
                      return await new Promise<
                        ReadableStreamReadResult<Uint8Array>
                      >((resolve, reject) => {
                        const abort = () => {
                          init.signal?.removeEventListener('abort', abort);
                          reject(aborted());
                        };
                        init.signal?.addEventListener('abort', abort, {
                          once: true,
                        });
                        if (init.signal?.aborted) abort();
                        else
                          acquiredReader
                            .read()
                            .then((result) => {
                              if (init.signal?.aborted) reject(aborted());
                              else resolve(result);
                            }, reject)
                            .finally(() =>
                              init.signal?.removeEventListener('abort', abort)
                            );
                      });
                    } catch (error) {
                      if (init.signal?.aborted) throw error;
                      try {
                        await cancel();
                      } catch {
                        /* Preserve read failure. */
                      }
                      throw error;
                    }
                  },
                  cancel,
                  releaseLock() {
                    acquiredReader.releaseLock();
                  },
                };
              },
            }
          : {}),
      };
      return new Proxy(response, {
        get(target, property) {
          if (property === 'body') return wrappedBody;
          if (property === 'text') return consumeText;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    } catch (error) {
      release();
      throw error;
    }
  };
}
