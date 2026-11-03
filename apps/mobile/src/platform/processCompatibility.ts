type NextTick = (callback: (...args: unknown[]) => void, ...args: unknown[]) => void;

/** Fill only the non-Node compatibility fields used by SDK stream dependencies. */
export function installNativeProcessCompatibility(host: { process?: unknown }, nextTick: NextTick): void {
  const target = host.process;
  if (!target || typeof target !== 'object' || Array.isArray(target) ||
      !('env' in target) || !target.env || typeof target.env !== 'object' || Array.isArray(target.env) ||
      ('browser' in target && typeof target.browser !== 'boolean') ||
      ('nextTick' in target && typeof target.nextTick !== 'function') ||
      typeof nextTick !== 'function')
    throw Error('NATIVE_PROCESS_UNAVAILABLE');
  const missingBrowser = !('browser' in target);
  const missingNextTick = !('nextTick' in target);
  if ((missingBrowser || missingNextTick) && !Object.isExtensible(target))
    throw Error('NATIVE_PROCESS_UNAVAILABLE');
  if (missingBrowser) Object.defineProperty(target, 'browser', {
    value: true, configurable: true, enumerable: true, writable: true,
  });
  if (missingNextTick) Object.defineProperty(target, 'nextTick', {
    value: nextTick, configurable: true, enumerable: true, writable: true,
  });
}

/** Native entries call this before evaluating the software SDK dependency graph. */
export function ensureNativeProcessCompatibility(): void {
  // Explicit browser entry uses a timer-backed scheduler and cannot load Node APIs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const shim = require('process/browser') as { nextTick: NextTick };
  installNativeProcessCompatibility(globalThis, shim.nextTick);
}
