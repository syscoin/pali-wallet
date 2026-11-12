const busyErrors = new WeakSet<object>();

/** Only an admitted native import may classify this as a transient failure. */
export function sentryKeyValidationBusy(): Error {
  const error = Object.assign(new Error('BUSY'), { code: 'BUSY' });
  busyErrors.add(error);
  return error;
}

export function isSentryKeyValidationBusy(error: unknown): error is Error {
  return error !== null && typeof error === 'object' && busyErrors.has(error);
}
