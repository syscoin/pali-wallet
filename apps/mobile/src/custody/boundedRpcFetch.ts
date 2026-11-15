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
    const release = () => {
      if (released) return;
      released = true;
      active--;
      queue.shift()?.run();
    };
    try {
      if (init.signal?.aborted) throw aborted();
      const response = await fetcher(url, init);
      const body = response.body;
      let text: Promise<string> | undefined,
        cancellation: Promise<void> | undefined;
      const consumeText = () =>
        (text ??= response.text().then(
          (value) => {
            release();
            return value;
          },
          async (error) => {
            try {
              if (body) await body.cancel();
            } finally {
              release();
            }
            throw error;
          }
        ));
      const cancel = (reason?: unknown) =>
        (cancellation ??= (async () => {
          try {
            if (body) await body.cancel(reason);
            else await consumeText();
          } finally {
            release();
          }
        })());
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
                let reader: ReadableStreamDefaultReader<Uint8Array>;
                try {
                  reader = body.getReader();
                } catch (error) {
                  void cancel().catch(() => undefined);
                  throw error;
                }
                let readerCancellation: Promise<void> | undefined;
                const cancelReader = (reason?: unknown) =>
                  (readerCancellation ??= (async () => {
                    try {
                      await reader.cancel(reason);
                    } finally {
                      release();
                    }
                  })());
                return {
                  async read() {
                    try {
                      return await reader.read();
                    } catch (error) {
                      try {
                        await cancelReader();
                      } catch {
                        /* Preserve read failure. */
                      }
                      throw error;
                    }
                  },
                  cancel: cancelReader,
                  releaseLock() {
                    reader.releaseLock();
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
