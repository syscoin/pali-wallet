import type {
  EvmSignedSubmission,
  EvmSubmissionLifecycle,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';

export function createTestEvmSubmissionCapture() {
  const retained = new Map<string, EvmSignedSubmission>();
  return (): EvmSubmissionLifecycle => ({
    assertCurrent: () => undefined,
    async persistSigned(record) {
      retained.set(record.hash, record);
    },
  });
}
