import { createRpcIdentityLease } from './rpcIdentityLease';

it('invalidates a warm lease after failed fresh verification', async () => {
  const verify = jest.fn().mockResolvedValue(undefined);
  const lease = createRpcIdentityLease(verify, () => 1);
  const signal = new AbortController().signal;
  await lease.ensure(signal);
  verify.mockRejectedValueOnce(new Error('RPC unavailable'));
  await expect(lease.ensure(signal, true)).rejects.toThrow('RPC unavailable');
  await lease.ensure(signal);
  expect(verify).toHaveBeenCalledTimes(3);
});

it('keeps shared verification alive for one remaining subscriber', async () => {
  let release!: () => void;
  let physical!: AbortSignal;
  const lease = createRpcIdentityLease(async (signal) => {
    physical = signal;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const cancelled = new AbortController();
  const a = lease.ensure(cancelled.signal);
  const failure = expect(a).rejects.toMatchObject({ name: 'AbortError' });
  const b = lease.ensure(new AbortController().signal);
  await Promise.resolve();
  cancelled.abort();
  await failure;
  expect(physical.aborted).toBe(false);
  release();
  await b;
});

it('abandons a stale verification and cannot publish its lease', async () => {
  let release!: () => void;
  const verify = jest.fn(
    async () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  const lease = createRpcIdentityLease(verify);
  const pending = lease.ensure(new AbortController().signal);
  const failure = expect(pending).rejects.toThrow();
  await Promise.resolve();
  lease.invalidate();
  release();
  await failure;
  verify.mockResolvedValueOnce(undefined);
  await lease.ensure(new AbortController().signal);
  expect(verify).toHaveBeenCalledTimes(2);
});

it('fresh control verification cannot join an older in-flight observation', async () => {
  let release!: () => void;
  const verify = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    )
    .mockResolvedValue(undefined);
  const lease = createRpcIdentityLease(verify);
  const old = lease.ensure(new AbortController().signal);
  await Promise.resolve();
  await lease.ensure(new AbortController().signal, true);
  expect(verify).toHaveBeenCalledTimes(2);
  release();
  await old;
});

it('invalidates every physical observation after concurrent fresh checks', async () => {
  const signals: AbortSignal[] = [];
  const releases: (() => void)[] = [];
  const lease = createRpcIdentityLease(async (signal) => {
    signals.push(signal);
    await new Promise<void>((resolve) => releases.push(resolve));
  });
  const first = lease.ensure(new AbortController().signal);
  const firstFailure = expect(first).rejects.toThrow();
  await Promise.resolve();
  const second = lease.ensure(new AbortController().signal, true);
  const secondFailure = expect(second).rejects.toThrow();
  await Promise.resolve();
  lease.invalidate();
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  await Promise.all([firstFailure, secondFailure]);
  releases.forEach((release) => release());
});
