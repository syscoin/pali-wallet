import type { PreferencePort } from '../core/securityPreferences.ts';

export const isPortfolioFilter = (value: unknown): value is string => typeof value === 'string' && /^(?:all|[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63})$/.test(value);

/** A failed or unknown preference never broadens a concrete filter into All. */
export function createPortfolioFilter(port: PreferencePort) {
  let writes: Promise<void> = Promise.resolve();
  let revision = 0;
  return {
    async load(): Promise<string> {
      for (;;) {
        const captured = revision;
        await writes;
        const value = await port.get();
        if (captured !== revision) continue;
        if (value === null) return 'all';
        if (!isPortfolioFilter(value)) throw Error('Unavailable portfolio filter');
        return value;
      }
    },
    save(value: string): Promise<void> {
      if (!isPortfolioFilter(value)) return Promise.reject(Error('Invalid portfolio filter'));
      revision++;
      const saved = writes.then(async () => {
        await port.set(value);
        if (await port.get() !== value) throw Error('Portfolio filter was not saved');
      });
      writes = saved.catch(() => undefined);
      return saved;
    },
  };
}
