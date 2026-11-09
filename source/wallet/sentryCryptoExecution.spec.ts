import { executeSentryCryptoJob } from './sentryCryptoExecution';
import type { SentryCryptoJob } from './sentryCryptoJobs';

const mockSign = jest.fn();
const mockVerify = jest.fn();
jest.mock(
  '@sidhujag/sysweb3-sentry',
  () => ({
    signSentryGovernanceVote: (...args: unknown[]) => mockSign(...args),
    verifySentryGovernanceVote: (...args: unknown[]) => mockVerify(...args),
  }),
  { virtual: true }
);
const job = {
  type: 'signVote',
  request: { proposalHash: 'reviewed-proposal' },
  context: { trusted: true },
  proTxHash: 'reviewed-node',
  key: { secretKey: 'private-synthetic-key' },
} as unknown as SentryCryptoJob;
beforeEach(() => {
  jest.clearAllMocks();
  mockSign.mockResolvedValue({ voteSig: 'signature' });
  mockVerify.mockResolvedValue(true);
});

it('does not start SDK work for an asynchronous authority predicate', async () => {
  await expect(
    executeSentryCryptoJob(job, (() =>
      Promise.resolve()) as unknown as () => void)
  ).rejects.toThrow('must be synchronous');
  expect(mockSign).not.toHaveBeenCalled();
});

it('rejects a signature returned after authority was revoked', async () => {
  let finish!: (value: unknown) => void;
  mockSign.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  let current = true;
  const result = executeSentryCryptoJob(job, () => {
    if (!current) throw new Error('CANCELLED');
  });
  current = false;
  finish({ voteSig: 'late-signature' });
  await expect(result).rejects.toThrow('CANCELLED');
  expect(mockVerify).not.toHaveBeenCalled();
});

it('never returns an unverified governance signature', async () => {
  mockVerify.mockResolvedValueOnce(false);
  await expect(executeSentryCryptoJob(job, () => undefined)).rejects.toThrow(
    'Sentry key validation or authorization failed'
  );
});

it('does not disclose SDK exceptions containing private input', async () => {
  mockSign.mockRejectedValueOnce(new Error('Invalid private-synthetic-key'));
  await expect(executeSentryCryptoJob(job, () => undefined)).rejects.toThrow(
    /^Sentry key validation or authorization failed$/
  );
});
