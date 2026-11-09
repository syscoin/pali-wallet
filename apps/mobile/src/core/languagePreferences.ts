import type { i18n, ResourceLanguage } from 'i18next';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { DEFAULT_PALI_LANGUAGE, isPaliLanguage, type PaliLanguage } from '../../../../source/shared/languagePolicy.ts';
import type { PreferencePort } from './securityPreferences.ts';

export type NativeLanguageValue = Readonly<{ language: PaliLanguage }>;
export type NativeLanguageState = Readonly<{
  status: 'opening' | 'ready' | 'unavailable';
  value: NativeLanguageValue | null;
}>;
const unavailable = () => new Error('LANGUAGE_PREFERENCE_UNAVAILABLE');

/** The same i18next engine as extension, with native protected preference I/O. */
export function createLanguagePreferences(ports: Readonly<{
  storage: PreferencePort;
  engine: i18n;
  load(language: PaliLanguage): Promise<ResourceLanguage>;
}>) {
  let state: NativeLanguageState = Object.freeze({ status: 'opening', value: null });
  let queue: Promise<unknown> = Promise.resolve();
  let epoch = 0;
  let loading: Promise<NativeLanguageValue> | undefined;
  const issued = new WeakMap<NativeLanguageValue, { raw: string | null; epoch: number; used: boolean }>();
  const listeners = new Set<() => void>();
  const publish = (next: NativeLanguageState) => {
    const published = Object.freeze(next);
    state = published;
    for (const listener of [...listeners]) {
      if (state !== published) break;
      if (listeners.has(listener)) { try { listener(); } catch { /* View observers cannot interrupt persistence. */ } }
    }
  };
  const queued = <T>(run: () => Promise<T>) => {
    const work = queue.then(run); queue = work.catch(() => undefined); return work;
  };
  const issue = (language: PaliLanguage, raw: string | null) => {
    const value = Object.freeze({ language }); issued.set(value, { raw, epoch, used: false });
    publish({ status: 'ready', value }); return value;
  };
  const resources = async (language: PaliLanguage, check: () => void) => {
    check();
    if (!ports.engine.hasResourceBundle(language, 'translation')) {
      const messages = await ports.load(language); check();
      ports.engine.addResourceBundle(language, 'translation', messages, true, true);
    }
    check();
  };
  const load = () => {
    if (loading) return loading;
    loading = queued(async () => {
      try {
        const raw = await ports.storage.get();
        const language = raw === null ? DEFAULT_PALI_LANGUAGE : raw;
        if (!isPaliLanguage(language)) throw unavailable();
        await resources(language, () => undefined);
        await ports.engine.changeLanguage(language);
        epoch++; return issue(language, raw);
      } catch {
        epoch++; publish({ status: 'unavailable', value: null }); throw unavailable();
      }
    }).finally(() => { loading = undefined; });
    return loading;
  };
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load,
    save(expected: NativeLanguageValue, language: PaliLanguage, assertCurrent: () => void): Promise<NativeLanguageValue> {
      return queued(async () => {
        const token = issued.get(expected), check = () => assertSynchronousEvmFeeGuard(assertCurrent);
        check();
        if (!isPaliLanguage(language) || state.status !== 'ready' || state.value !== expected || !token || token.used || token.epoch !== epoch)
          throw unavailable();
        token.used = true;
        try {
          await resources(language, check);
          if (await ports.storage.get() !== token.raw) throw unavailable(); check();
          await ports.storage.set(language); check();
          if (await ports.storage.get() !== language) throw unavailable(); check();
          await ports.engine.changeLanguage(language); check();
          epoch++; return issue(language, language);
        } catch {
          epoch++; publish({ status: 'unavailable', value: null }); throw unavailable();
        }
      });
    },
  });
}
