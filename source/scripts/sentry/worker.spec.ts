const mockSign = jest.fn();
const mockVerify = jest.fn();
const mockIds = jest.fn();
const mockFeeVerify = jest.fn();
const mockFeeReview = jest.fn();
jest.mock(
  '@sidhujag/sysweb3-sentry',
  () => ({
    importSentryAuthorityKey: jest.fn(),
    signSentryManagementOperation: jest.fn(),
    signSentryOperation: jest.fn(),
    signSentryGovernanceVote: (...args: unknown[]) => mockSign(...args),
    verifySentryGovernanceVote: (...args: unknown[]) => mockVerify(...args),
    governanceVotingKeyIds: (...args: unknown[]) => mockIds(...args),
    verifySentryOperation: (...args: unknown[]) => mockFeeVerify(...args),
    verifySentryManagementOperation: (...args: unknown[]) =>
      mockFeeVerify(...args),
    reviewSentryOperation: (...args: unknown[]) => mockFeeReview(...args),
    reviewSentryManagementOperation: (...args: unknown[]) =>
      mockFeeReview(...args),
  }),
  { virtual: true }
);

let worker: any;
beforeEach(() => {
  jest.clearAllMocks();
  worker = { postMessage: jest.fn() };
  Object.defineProperty(global, 'self', { value: worker, configurable: true });
  jest.isolateModules(() => require('./worker'));
  mockIds.mockResolvedValue({
    compressed: '11'.repeat(20),
    uncompressed: '22'.repeat(20),
  });
  mockSign.mockResolvedValue({ voteSig: 'canonical-signature' });
  mockVerify.mockResolvedValue(true);
  mockFeeVerify.mockResolvedValue(true);
  mockFeeReview.mockReturnValue({
    operation: 'updateService',
    feeSatoshis: '1000',
  });
});

it.each([
  'updateService',
  'register',
  'updateRegistrar',
  'revoke',
  'registerOperator',
  'rotateOperator',
])(
  'requires complete canonical %s authorization before returning a fee review',
  async (operation) => {
    const job = {
      type: 'verifyFee',
      request: { operation },
      context: { trusted: true },
    };
    await worker.onmessage({ data: { job } });
    expect(mockFeeVerify).toHaveBeenCalledWith(job.request, job.context);
    expect(mockFeeReview).toHaveBeenCalledWith(job.request, job.context);
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      success: true,
      result: { operation: 'updateService', feeSatoshis: '1000' },
    });
    mockFeeVerify.mockResolvedValue(false);
    mockFeeReview.mockClear();
    await worker.onmessage({ data: { job } });
    expect(mockFeeReview).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ success: false })
    );
  }
);

it('keeps unsigned operation review separate from complete fee authorization verification', async () => {
  await worker.onmessage({
    data: {
      job: {
        type: 'reviewOperation',
        request: { operation: 'updateService' },
        context: {},
      },
    },
  });
  expect(mockFeeVerify).not.toHaveBeenCalled();
  expect(mockFeeReview).toHaveBeenCalled();
});

it('expands only bounded public voting identities in the isolated worker', async () => {
  await worker.onmessage({
    data: {
      job: { type: 'votingIdentities', publicKeys: ['02' + '33'.repeat(32)] },
    },
  });
  expect(mockIds).toHaveBeenCalledTimes(1);
  expect(worker.postMessage).toHaveBeenCalledWith({
    success: true,
    result: [
      {
        publicKey: '02' + '33'.repeat(32),
        compressed: '11'.repeat(20),
        uncompressed: '22'.repeat(20),
      },
    ],
  });
  mockIds.mockClear();
  await worker.onmessage({
    data: {
      job: { type: 'votingIdentities', publicKeys: Array(101).fill('public') },
    },
  });
  expect(mockIds).not.toHaveBeenCalled();
  expect(worker.postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({ success: false })
  );
});

it('independently verifies each signed vote before replying and never returns the key', async () => {
  const job = {
    type: 'signVote',
    request: { proposalHash: '44'.repeat(32) },
    context: { verified: true },
    proTxHash: '55'.repeat(32),
    key: { secretKey: 'private-synthetic-key' },
  };
  await worker.onmessage({ data: { job } });
  expect(mockSign).toHaveBeenCalledWith(
    job.request,
    job.context,
    job.proTxHash,
    job.key
  );
  expect(mockVerify).toHaveBeenCalledWith(job.request, job.context, {
    voteSig: 'canonical-signature',
  });
  expect(JSON.stringify(worker.postMessage.mock.calls)).not.toContain(
    job.key.secretKey
  );
  mockVerify.mockResolvedValue(false);
  await worker.onmessage({ data: { job } });
  expect(worker.postMessage).toHaveBeenLastCalledWith({
    success: false,
    error: 'Sentry key validation or authorization failed',
  });
});

it('does not forward cryptographic exceptions containing supplied secrets', async () => {
  mockSign.mockRejectedValue(new Error('rejected private-synthetic-key'));
  await worker.onmessage({
    data: {
      job: {
        type: 'signVote',
        request: {},
        context: {},
        proTxHash: 'node',
        key: { secretKey: 'private-synthetic-key' },
      },
    },
  });
  expect(worker.postMessage).toHaveBeenCalledWith({
    success: false,
    error: 'Sentry key validation or authorization failed',
  });
  expect(JSON.stringify(worker.postMessage.mock.calls)).not.toContain(
    'private-synthetic-key'
  );
});
