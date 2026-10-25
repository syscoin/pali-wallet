import { AbiCoder, keccak256 } from 'ethers';

import { PRIVACY_POOLS } from './registry';
import { readPrivacyRelayerJob } from './relayJobs';

const JOB = '00000000-0000-4000-8000-000000001234';
const proof = `0x${'01'.repeat(256)}`;
const args = [
  `0x${'01'.repeat(32)}`,
  `0x${'02'.repeat(32)}`,
  `0x${'11'.repeat(20)}`,
  `0x${'22'.repeat(20)}`,
  `0x${'0'.repeat(63)}1`,
  `0x${'0'.repeat(64)}`,
];
const reference = () => ({
  endpoint: 'https://relay.example',
  jobId: JOB,
  poolId: 'eth-1' as const,
  proofHash: keccak256(proof),
  inputHash: keccak256(
    AbiCoder.defaultAbiCoder().encode(
      Array(6).fill('uint256'),
      args.map((arg) => BigInt(arg).toString())
    )
  ),
});
const job = () => ({
  id: JOB,
  type: 'TORNADO_WITHDRAW',
  status: 'SENT',
  txHash: `0x${'ab'.repeat(32)}`,
  contract: PRIVACY_POOLS[1].address,
  proof,
  args: [...args],
  failedReason: 'untrusted details',
  note: 'never project',
});
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });

it('reads only the immutable job URL and returns bound claimed status without response secrets', async () => {
  const fetcher = jest.fn(async () => response(job())),
    guard = jest.fn();
  const result = await readPrivacyRelayerJob(reference(), {
    fetcher,
    assertCurrent: guard,
  });
  expect(fetcher).toHaveBeenCalledWith(
    `https://relay.example/v1/jobs/${JOB}`,
    expect.objectContaining({
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
  );
  expect(result).toEqual({
    jobId: JOB,
    claimedStatus: 'SENT',
    transactionHash: `0x${'ab'.repeat(32)}`,
  });
  expect(Object.isFrozen(result)).toBe(true);
  expect(guard.mock.calls.length).toBeGreaterThan(1);
});

it.each([
  'QUEUED',
  'ACCEPTED',
  'SENT',
  'MINED',
  'RESUBMITTED',
  'CONFIRMED',
  'FAILED',
])('keeps %s explicitly relayer-reported', async (status) => {
  const value = job();
  value.status = status;
  const result = await readPrivacyRelayerJob(reference(), {
    fetcher: async () => response(value),
    assertCurrent: () => undefined,
  });
  expect(result.claimedStatus).toBe(status);
  expect(result).not.toHaveProperty('spent');
  expect(result).not.toHaveProperty('success');
});

it.each(['id', 'type', 'status', 'contract', 'proof', 'txHash'])(
  'rejects mismatched or malformed %s',
  async (field) => {
    const value = job();
    (value as any)[field] = 'substituted';
    await expect(
      readPrivacyRelayerJob(reference(), {
        fetcher: async () => response(value),
        assertCurrent: () => undefined,
      })
    ).rejects.toThrow('privacy_relayer_job_invalid');
  }
);

it.each([0, 1, 2, 3, 4, 5])(
  'rejects substituted proof input %s',
  async (index) => {
    const value = job();
    value.args[index] = `0x${(BigInt(value.args[index]) + BigInt(1))
      .toString(16)
      .padStart(index === 2 || index === 3 ? 40 : 64, '0')}`;
    await expect(
      readPrivacyRelayerJob(reference(), {
        fetcher: async () => response(value),
        assertCurrent: () => undefined,
      })
    ).rejects.toThrow('privacy_relayer_job_invalid');
  }
);

it('rejects a different valid-length proof and accepts numerically equivalent input case', async () => {
  const bad = job();
  bad.proof = `0x${'02'.repeat(256)}`;
  await expect(
    readPrivacyRelayerJob(reference(), {
      fetcher: async () => response(bad),
      assertCurrent: () => undefined,
    })
  ).rejects.toThrow('privacy_relayer_job_invalid');
  const same = job();
  same.args = same.args.map((arg) => '0x' + arg.slice(2).toUpperCase());
  await expect(
    readPrivacyRelayerJob(reference(), {
      fetcher: async () => response(same),
      assertCurrent: () => undefined,
    })
  ).resolves.toMatchObject({ claimedStatus: 'SENT' });
});

it('rejects altered stored hash before accepting an otherwise valid job', async () => {
  const ref = reference();
  ref.inputHash = `0x${'ff'.repeat(32)}`;
  await expect(
    readPrivacyRelayerJob(ref, {
      fetcher: async () => response(job()),
      assertCurrent: () => undefined,
    })
  ).rejects.toThrow('privacy_relayer_job_invalid');
});

it('guards session and cancellation before network and after response', async () => {
  const fetcher = jest.fn(async () => response(job())),
    abort = new AbortController();
  abort.abort();
  await expect(
    readPrivacyRelayerJob(reference(), {
      fetcher,
      assertCurrent: () => undefined,
      signal: abort.signal,
    })
  ).rejects.toThrow('privacy_relayer_cancelled');
  expect(fetcher).not.toHaveBeenCalled();
  let valid = true;
  await expect(
    readPrivacyRelayerJob(reference(), {
      fetcher: async () => {
        valid = false;
        return response(job());
      },
      assertCurrent: () => {
        if (!valid) throw new Error('locked');
      },
    })
  ).rejects.toThrow('privacy_vault_session_changed');
});

it('timeouts are bounded and errors never contain untrusted JSON fragments', async () => {
  await expect(
    readPrivacyRelayerJob(reference(), {
      fetcher: async () =>
        new Response('private malformed data', {
          headers: { 'content-type': 'application/json' },
        }),
      assertCurrent: () => undefined,
    })
  ).rejects.toThrow('privacy_relayer_job_unavailable');
  jest.useFakeTimers();
  try {
    const pending = readPrivacyRelayerJob(reference(), {
      fetcher: async () => new Promise<Response>(() => undefined),
      assertCurrent: () => undefined,
    });
    const rejected = expect(pending).rejects.toThrow('privacy_relayer_timeout');
    await jest.advanceTimersByTimeAsync(5000);
    await rejected;
  } finally {
    jest.useRealTimers();
  }
});

it('rejects redirected, oversized, missing and invalid jobs', async () => {
  for (const result of [
    new Response('{}', { status: 404 }),
    new Response('x'.repeat(65537), {
      headers: { 'content-type': 'application/json' },
    }),
    new Response('{}', {
      headers: {
        'content-type': 'application/json',
        'content-length': '1000000',
      },
    }),
  ]) {
    await expect(
      readPrivacyRelayerJob(reference(), {
        fetcher: async () => result,
        assertCurrent: () => undefined,
      })
    ).rejects.toThrow('privacy_relayer_job_invalid');
  }
});
