import type {
  EvmSignedSubmission,
  EvmSubmissionLifecycle,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';

export function createTestEvmSubmissionCapture() {
  const retained = new Map<string, EvmSignedSubmission>();
  return (): EvmSubmissionLifecycle => ({
    assertCurrent: () => undefined,
    dispatchSigned: async (_record, initiate, preflight) => {
      await preflight();
      return initiate();
    },
    async persistSigned(record) {
      retained.set(record.hash, record);
    },
  });
}
