import {
  ExecutionSimulationUnsupportedError,
  normalizeExecutionSimulationError,
} from './executionSimulationError';

it.each([-32601, 4200])(
  'classifies only explicit method-unavailable code %s',
  (code) => {
    const error = normalizeExecutionSimulationError({
      code,
      message: 'Method unavailable',
    });
    expect(error).toBeInstanceOf(ExecutionSimulationUnsupportedError);
    expect((error as Error).message).toContain('This RPC endpoint');
  }
);

it('accepts the ethers method-error wrapper without classifying execution or cancellation errors', () => {
  const wrapped = Object.assign(new Error('could not coalesce error'), {
    code: 'UNKNOWN_ERROR',
    error: { code: -32601, message: 'Method unavailable' },
  });
  expect(normalizeExecutionSimulationError(wrapped)).toBeInstanceOf(
    ExecutionSimulationUnsupportedError
  );
  for (const error of [
    Object.assign(new Error('Method unavailable'), { code: -32000 }),
    Object.assign(new Error('execution reverted'), {
      code: 'CALL_EXCEPTION',
      error: { code: -32601, message: 'Method unavailable' },
    }),
    Object.assign(new Error('aborted'), { code: 'CANCELLED' }),
    { code: -32601 },
  ])
    expect(normalizeExecutionSimulationError(error)).toBe(error);
});
