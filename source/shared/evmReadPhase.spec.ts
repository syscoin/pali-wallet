import { withEvmReadPhase, EVM_READ_PHASE_TIMEOUT_MS } from './evmReadPhase';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const fixture = () => {
  const abort = new AbortController();
  const provider = {
    signal: abort.signal,
    verifyConfiguredChainId: jest.fn(async () => undefined),
    send: jest.fn(async () => '0x1'),
    readMany: jest.fn(async (requests, options?: { signal: AbortSignal }) => {
      expect(options?.signal).toBeDefined();
      return requests.map(() => ({
        status: 'fulfilled',
        value: { value: '0x1' },
      }));
    }),
    getNetwork: jest.fn(async () => ({ chainId: BigInt(1) })),
    getFeeData: jest.fn(async () => ({ gasPrice: '0x1' })),
    getSigner: jest.fn(),
    broadcastTransaction: jest.fn(),
  };
  return { provider, abort };
};
beforeEach(() => jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }));
afterEach(() => jest.useRealTimers());

it('joins exact reads, batches distinct selectors and gives each consumer its own result', async () => {
  const { provider } = fixture();
  await withEvmReadPhase(
    provider,
    () => undefined,
    async (phase) => {
      const [first, duplicate, pending] = await Promise.all([
        phase.send('eth_getBalance', ['address', '0x5']),
        phase.send('eth_getBalance', ['address', '0x5']),
        phase.send('eth_getBalance', ['address', 'pending']),
      ]);
      first.value = 'changed';
      expect(duplicate).toEqual({ value: '0x1' });
      expect(pending).toEqual({ value: '0x1' });
      expect(provider.readMany).toHaveBeenCalledTimes(1);
      expect(provider.readMany.mock.calls[0][0]).toEqual([
        { method: 'eth_getBalance', params: ['address', '0x5'] },
        { method: 'eth_getBalance', params: ['address', 'pending'] },
      ]);
    }
  );
  expect(provider.verifyConfiguredChainId.mock.calls).toEqual([[true], [true]]);
});
it('retires all exposed methods and never exposes signer or broadcast methods', async () => {
  const { provider } = fixture();
  const phase = await withEvmReadPhase(
    provider,
    () => undefined,
    async (value) => {
      expect(value.getSigner).toBeUndefined();
      expect(value.broadcastTransaction).toBeUndefined();
      await value.getFeeData();
      await value.getFeeData();
      return value;
    }
  );
  expect(provider.getFeeData).toHaveBeenCalledTimes(1);
  expect(() => phase.getFeeData()).toThrow('phase ended');
  expect(() => phase.getNetwork()).toThrow('phase ended');
  await expect(phase.readMany([])).rejects.toThrow('phase ended');
  expect(() => phase.send('eth_getBalance', ['address', 'pending'])).toThrow(
    'phase ended'
  );
  expect(provider.getSigner).not.toHaveBeenCalled();
});
it('enforces the total timeout and cancels the phase transport', async () => {
  const { provider } = fixture();
  provider.readMany.mockImplementation(() => new Promise(() => undefined));
  const run = withEvmReadPhase(
    provider,
    () => undefined,
    async (phase) => phase.send('eth_call', [{ to: 'address' }, 'pending'])
  );
  const failed = expect(run).rejects.toThrow('phase timed out');
  await jest.advanceTimersByTimeAsync(EVM_READ_PHASE_TIMEOUT_MS);
  await failed;
  expect(provider.readMany.mock.calls[0][1]!.signal.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
it('rejects a late helper result after owner retirement', async () => {
  const { provider } = fixture();
  const delayed = deferred<any>();
  provider.getFeeData.mockReturnValue(delayed.promise);
  let current = true;
  const run = withEvmReadPhase(
    provider,
    () => {
      if (!current) throw new Error('owner changed');
    },
    async (phase) => phase.getFeeData()
  );
  await jest.advanceTimersByTimeAsync(0);
  current = false;
  delayed.resolve({ gasPrice: '0x1' });
  await expect(run).rejects.toThrow('owner changed');
});
it('snapshots parameters before dispatch without invoking accessors or toJSON', async () => {
  const { provider } = fixture();
  const getter = jest.fn(() => 'pending');
  const toJSON = jest.fn();
  await withEvmReadPhase(
    provider,
    () => undefined,
    async (phase) => {
      const params = [{ to: 'address' }, 'pending'];
      const result = phase.send('eth_call', params);
      (params[0] as any).to = 'changed';
      await result;
      expect(provider.readMany.mock.calls[0][0][0].params[0].to).toBe(
        'address'
      );
      expect(() => phase.send('eth_call', [{ toJSON }])).toThrow();
      const bad = Object.defineProperty({}, 'to', {
        enumerable: true,
        get: getter,
      });
      expect(() => phase.send('eth_call', [bad])).toThrow();
      await expect(
        phase.readMany([
          {
            get method() {
              return getter();
            },
            params: [],
          },
        ])
      ).rejects.toThrow();
    }
  );
  expect(getter).not.toHaveBeenCalled();
  expect(toJSON).not.toHaveBeenCalled();
});
it('rejects writes and caps unique reads at 200', async () => {
  const { provider } = fixture();
  await withEvmReadPhase(
    provider,
    () => undefined,
    async (phase) => {
      expect(() => phase.send('eth_sendRawTransaction', ['0x'])).toThrow(
        'Unsupported'
      );
      for (let i = 0; i < 200; i++)
        await phase.send('eth_getBalance', [String(i), 'pending']);
      expect(() => phase.send('eth_getBalance', ['201', 'pending'])).toThrow(
        'work limit'
      );
    }
  );
});
it('guards a delegated native phase and its helpers after completion', async () => {
  const { provider } = fixture();
  const native = {
    ...provider,
    withReadPhase: jest.fn(async (work) => work(provider)),
  };
  const phase = await withEvmReadPhase(
    native,
    () => undefined,
    async (value) => {
      await value.send('eth_getCode', ['address', 'pending']);
      return value;
    }
  );
  expect(native.withReadPhase).toHaveBeenCalledTimes(1);
  expect(provider.verifyConfiguredChainId).not.toHaveBeenCalled();
  expect(() => phase.send('eth_getCode', ['address', 'pending'])).toThrow(
    'phase ended'
  );
});
