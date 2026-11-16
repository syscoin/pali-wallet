export class ExecutionSimulationUnsupportedError extends Error {
  readonly code = 'SMART_ACCOUNT_SIMULATION_UNSUPPORTED';

  constructor() {
    super(
      'This RPC endpoint does not support the exact transaction simulation required for this smart account action.'
    );
    this.name = 'ExecutionSimulationUnsupportedError';
  }
}

/** Only explicit method-unavailable codes qualify. Execution failures retain their cause. */
export function normalizeExecutionSimulationError(error: unknown): unknown {
  if (error instanceof ExecutionSimulationUnsupportedError) return error;
  if (!error || typeof error !== 'object') return error;
  const message = Object.getOwnPropertyDescriptor(error, 'message')?.value;
  if (typeof message !== 'string' || message.length === 0) return error;
  const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
  if (code === -32601 || code === 4200)
    return new ExecutionSimulationUnsupportedError();
  if (code === 'UNKNOWN_ERROR' || code === 'UNSUPPORTED_OPERATION') {
    const nested = Object.getOwnPropertyDescriptor(error, 'error')?.value;
    if (nested && typeof nested === 'object') {
      const nestedCode = Object.getOwnPropertyDescriptor(nested, 'code')?.value;
      const nestedMessage = Object.getOwnPropertyDescriptor(
        nested,
        'message'
      )?.value;
      if (
        (nestedCode === -32601 || nestedCode === 4200) &&
        typeof nestedMessage === 'string' &&
        nestedMessage.length > 0
      )
        return new ExecutionSimulationUnsupportedError();
    }
  }
  return error;
}
