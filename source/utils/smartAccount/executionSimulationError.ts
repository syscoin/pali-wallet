export class ExecutionSimulationEvidenceError extends Error {
  constructor() {
    super('Unable to verify smart account execution');
    this.name = 'ExecutionSimulationEvidenceError';
  }
}

export class ExecutionSimulationUnsupportedError extends Error {
  readonly code = 'SMART_ACCOUNT_SIMULATION_UNSUPPORTED';

  constructor() {
    super(
      'This RPC endpoint does not support the exact transaction simulation required for this smart account action.'
    );
    this.name = 'ExecutionSimulationUnsupportedError';
  }
}

const PAYER_PENDING_MESSAGE =
  'An earlier fee-payer transaction must confirm before this action can continue. Wait for confirmation, then try again.';

export class SmartAccountPayerPendingError extends Error {
  readonly code = 'SMART_ACCOUNT_PAYER_PENDING';

  constructor() {
    super(PAYER_PENDING_MESSAGE);
    this.name = 'SmartAccountPayerPendingError';
  }
}

/** The popup transport may retain only the fixed message. Display guidance only. */
export function isSmartAccountPayerPendingError(error: unknown): boolean {
  if (error === PAYER_PENDING_MESSAGE) return true;
  if (!error || typeof error !== 'object') return false;
  return (
    Object.getOwnPropertyDescriptor(error, 'message')?.value ===
    PAYER_PENDING_MESSAGE
  );
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
