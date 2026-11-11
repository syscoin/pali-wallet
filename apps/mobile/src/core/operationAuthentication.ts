const explicitCancellations = new WeakSet<object>();

/** Native adapter only: mark an explicit OS Cancel, never a lifecycle fault. */
export function operationAuthenticationCancellation(): Error {
  const error = new Error('CANCELLED');
  explicitCancellations.add(error);
  return error;
}

export function isOperationAuthenticationCancellation(error: unknown): error is Error {
  return !!error && typeof error === 'object' && explicitCancellations.has(error);
}
