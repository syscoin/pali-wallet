import { namehash } from 'ethers';

import { PRIVACY_POOLS } from './registry';
import {
  createPrivacyRelayerClient,
  PRIVACY_RELAYER_DIRECTORY_URL,
  PRIVACY_RELAYER_MAX_AGE_MS,
  PRIVACY_RELAYER_SOURCE,
  PRIVACY_RELAYER_TIMEOUT_MS,
  quotePrivacyRelayerFee,
  validatePrivacyRelayerEndpoint,
} from './relayers';

const NOW = 2000000000000;
const ensHash = namehash('relay.eth');
const rewardAccount = '0x1111111111111111111111111111111111111111';
const source = () => ({ ...PRIVACY_RELAYER_SOURCE });
const entry = () => ({
  ensName: 'relay.eth',
  ensHash,
  owner: rewardAccount,
  registryBalance: '123',
  health: 'reported-healthy',
  endpoint: 'https://relay.example',
  rewardAccount,
  supportedPools: PRIVACY_POOLS.map((p) => p.id),
  advertisedServiceFeePercent: '0.3',
  advertisedQueueLength: 1,
  version: '5.0.1',
  statusObservedAt: NOW - 1000,
});
const directory = () => ({
  version: 1,
  chainId: 1,
  source: source(),
  asOfBlockNumber: 20000000,
  asOfBlockHash: `0x${'11'.repeat(32)}`,
  asOfBlockTimestamp: NOW / 1000 - 720,
  observedAt: NOW - 500,
  candidateCount: 1,
  unavailableEntries: 0,
  relayers: [entry()],
});
const status = () => ({
  netId: 1,
  rewardAccount,
  tornadoServiceFee: 0.3,
  health: { status: 'true', errorsLog: 'private server error' },
  currentQueue: 2,
  version: '5.0.1',
  instances: {
    eth: {
      decimals: 18,
      instanceAddress: Object.fromEntries(
        PRIVACY_POOLS.map((p) => [p.amount, p.address])
      ),
    },
  },
});
function response(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json',
      'x-privacy-index-state': 'ready',
      ...headers,
    },
  });
}
function setup() {
  let now = NOW;
  const fetcher = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>(
    async () => response(directory())
  );
  const client = createPrivacyRelayerClient({ fetcher, now: () => now });
  return {
    client,
    fetcher,
    time: (value: number) => {
      now = value;
    },
  };
}

test('directory is one anonymous fixed bulk request with immutable projected fields', async () => {
  const run = setup();
  const raw = directory();
  (raw.relayers[0] as any).errorsLog = 'do not forward';
  run.fetcher.mockResolvedValueOnce(response(raw));
  const result = await run.client.getDirectory();
  expect(run.fetcher).toHaveBeenCalledTimes(1);
  expect(run.fetcher).toHaveBeenCalledWith(
    PRIVACY_RELAYER_DIRECTORY_URL,
    expect.objectContaining({
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
  );
  expect(run.fetcher.mock.calls[0][1]).not.toHaveProperty('body');
  expect(JSON.stringify(result)).not.toContain('errorsLog');
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.relayers)).toBe(true);
  expect(Object.isFrozen(result.relayers[0])).toBe(true);
  expect(Object.isFrozen(result.relayers[0].supportedPools)).toBe(true);
  expect(Object.isFrozen(result.source)).toBe(true);
});

test('only the explicitly selected endpoint is checked and identity remains pinned', async () => {
  const run = setup();
  const result = await run.client.getDirectory();
  run.fetcher.mockResolvedValueOnce(response(status()));
  const selected = await run.client.checkRelayer(result, ensHash, 'eth-0.1');
  expect(run.fetcher).toHaveBeenLastCalledWith(
    'https://relay.example/status',
    expect.objectContaining({
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
    })
  );
  expect(selected).toMatchObject({
    endpoint: 'https://relay.example',
    rewardAccount,
    advertisedServiceFeePercent: '0.3',
    advertisedQueueLength: 2,
    poolId: 'eth-0.1',
  });
  expect(Object.isFrozen(selected)).toBe(true);
  expect(() => run.client.assertSelectionCurrent(selected)).not.toThrow();
  expect(() => run.client.assertSelectionCurrent({ ...selected })).toThrow(
    'privacy_relayer_data_invalid'
  );
  expect(run.fetcher).toHaveBeenCalledTimes(2);
});

test.each([
  'registry',
  'implementation',
  'implementationCodeHash',
  'ensRegistry',
  'deploymentBlock',
  'urlRecord',
  'chainId',
])('rejects changed source pin %s', async (field) => {
  const run = setup(),
    raw = directory();
  (raw.source as any)[field] = 'changed';
  run.fetcher.mockResolvedValueOnce(response(raw));
  await expect(run.client.getDirectory()).rejects.toThrow(
    'privacy_relayer_data_invalid'
  );
});

test.each([
  ['version', 2],
  ['chainId', 5],
  ['asOfBlockNumber', 1],
  ['asOfBlockHash', '0x1234'],
  ['candidateCount', 257],
  ['candidateCount', 0],
  ['unavailableEntries', 2],
  ['observedAt', NOW - PRIVACY_RELAYER_MAX_AGE_MS],
  ['asOfBlockTimestamp', NOW / 1000 - 1800],
  ['observedAt', NOW + 30001],
])('rejects malformed or stale directory field %s', async (field, value) => {
  const run = setup(),
    raw = directory();
  (raw as any)[field] = value;
  run.fetcher.mockResolvedValueOnce(response(raw));
  await expect(run.client.getDirectory()).rejects.toThrow(/^privacy_relayer_/);
});

test.each([
  ['ensHash', `0x${'22'.repeat(32)}`],
  ['owner', `0x${'00'.repeat(20)}`],
  ['registryBalance', '-1'],
  ['advertisedServiceFeePercent', '1e-4'],
  ['advertisedServiceFeePercent', '100.000000000000000001'],
  ['advertisedQueueLength', 1000001],
  ['version', '<script>'],
  ['supportedPools', ['eth-1000']],
  ['supportedPools', ['eth-1', 'eth-1']],
  ['statusObservedAt', NOW - PRIVACY_RELAYER_MAX_AGE_MS],
  ['statusObservedAt', NOW],
  ['health', 'verified'],
])('rejects malformed relayer field %s', async (field, value) => {
  const run = setup(),
    raw = directory();
  (raw.relayers[0] as any)[field] = value;
  run.fetcher.mockResolvedValueOnce(response(raw));
  await expect(run.client.getDirectory()).rejects.toThrow(/^privacy_relayer_/);
});

test('rejects duplicate ENS identities and an expired directory before endpoint contact', async () => {
  const run = setup(),
    raw = directory();
  raw.candidateCount = 2;
  raw.relayers.push(entry());
  run.fetcher.mockResolvedValueOnce(response(raw));
  await expect(run.client.getDirectory()).rejects.toThrow(
    'privacy_relayer_data_invalid'
  );
  const good = await run.client.getDirectory();
  run.time(NOW + PRIVACY_RELAYER_MAX_AGE_MS);
  await expect(run.client.checkRelayer(good, ensHash, 'eth-1')).rejects.toThrow(
    'privacy_relayer_stale'
  );
  expect(run.fetcher).toHaveBeenCalledTimes(2);
});

test('cannot supply a hand-built or other-client directory as endpoint authority', async () => {
  const run = setup();
  const result = await run.client.getDirectory();
  await expect(
    run.client.checkRelayer({ ...result }, ensHash, 'eth-1')
  ).rejects.toThrow('privacy_relayer_data_invalid');
  await expect(
    createPrivacyRelayerClient().checkRelayer(result, ensHash, 'eth-1')
  ).rejects.toThrow('privacy_relayer_data_invalid');
  expect(run.fetcher).toHaveBeenCalledTimes(1);
});

test.each(['unavailable', 'reported-unhealthy'])(
  'does not probe an %s entry',
  async (health) => {
    const run = setup(),
      raw = directory();
    raw.relayers[0].health = health;
    run.fetcher.mockResolvedValueOnce(response(raw));
    const result = await run.client.getDirectory();
    await expect(
      run.client.checkRelayer(result, ensHash, 'eth-1')
    ).rejects.toThrow('privacy_relayer_unavailable');
    expect(run.fetcher).toHaveBeenCalledTimes(1);
    if (health === 'unavailable')
      expect(result.relayers[0].endpoint).toBeUndefined();
  }
);

test.each([
  'http://relay.example',
  'https://127.1',
  'https://2130706433',
  'https://0x7f000001',
  'https://[::1]',
  'https://localhost',
  'https://a.local',
  'https://a.internal',
  'https://a.localhost',
  'https://a.invalid',
  'https://relay.example.',
  'https://relay.example:8443',
  'https://a:b@relay.example',
  'https://relay.example/path',
  'https://relay.example?note=secret',
  'https://relay.example#x',
  'https://relay.example\\@evil.example',
])('rejects unsafe endpoint %s', (value) =>
  expect(() => validatePrivacyRelayerEndpoint(value)).toThrow()
);

test.each([
  ['rewardAccount', '0x2222222222222222222222222222222222222222'],
  ['tornadoServiceFee', '0.31'],
  ['version', '5.0.2'],
  ['health', { status: false }],
])(
  'changed selected %s invalidates before proof preparation',
  async (field, value) => {
    const run = setup(),
      result = await run.client.getDirectory(),
      raw = status();
    (raw as any)[field] = value;
    run.fetcher.mockResolvedValueOnce(response(raw));
    await expect(
      run.client.checkRelayer(result, ensHash, 'eth-1')
    ).rejects.toThrow('privacy_relayer_changed');
  }
);

test('rejects status pool substitution and changed supported pool set', async () => {
  const run = setup(),
    result = await run.client.getDirectory(),
    raw = status();
  raw.instances.eth.instanceAddress['0.1'] = rewardAccount;
  run.fetcher.mockResolvedValueOnce(response(raw));
  await expect(
    run.client.checkRelayer(result, ensHash, 'eth-1')
  ).rejects.toThrow('privacy_relayer_data_invalid');
  const changed = status();
  delete changed.instances.eth.instanceAddress['100'];
  run.fetcher.mockResolvedValueOnce(response(changed));
  await expect(
    run.client.checkRelayer(result, ensHash, 'eth-1')
  ).rejects.toThrow('privacy_relayer_changed');
});

test('fresh status does not revive expired directory or selection', async () => {
  const run = setup(),
    result = await run.client.getDirectory();
  run.fetcher.mockImplementationOnce(async () => {
    run.time(NOW + PRIVACY_RELAYER_MAX_AGE_MS);
    return response(status());
  });
  await expect(
    run.client.checkRelayer(result, ensHash, 'eth-1')
  ).rejects.toThrow('privacy_relayer_stale');
});

test.each(['stale', 'unknown', ''])(
  'rejects noncurrent directory header %s',
  async (state) => {
    const run = setup();
    run.fetcher.mockResolvedValueOnce(
      response(directory(), { 'x-privacy-index-state': state })
    );
    await expect(run.client.getDirectory()).rejects.toThrow(
      /^privacy_relayer_/
    );
  }
);

test('allows refreshing header only while original observation remains fresh', async () => {
  const run = setup();
  run.fetcher.mockResolvedValueOnce(
    response(directory(), { 'x-privacy-index-state': 'refreshing' })
  );
  expect((await run.client.getDirectory()).state).toBe('refreshing');
});

test.each([202, 302, 503])(
  'rejects unavailable directory response %s',
  async (code) => {
    const run = setup();
    run.fetcher.mockResolvedValueOnce(new Response('{}', { status: code }));
    await expect(run.client.getDirectory()).rejects.toThrow(
      /^privacy_relayer_/
    );
  }
);

test('bounds content length and streamed bytes and sanitizes JSON errors', async () => {
  const run = setup();
  for (const bad of [
    response({}, { 'content-length': '10000000' }),
    response({}, { 'content-length': '1e3' }),
    response({}, { 'content-type': 'text/html' }),
    new Response('sensitive malformed content', {
      headers: { 'content-type': 'application/json' },
    }),
    new Response(new Uint8Array(512 * 1024 + 1), {
      headers: { 'content-type': 'application/json' },
    }),
  ]) {
    run.fetcher.mockResolvedValueOnce(bad);
    await expect(run.client.getDirectory()).rejects.toThrow(
      /^privacy_relayer_[a-z_]+$/
    );
  }
});

test('cancelled request never connects, and timeout bounds an unresponsive fetch', async () => {
  const run = setup(),
    abort = new AbortController();
  abort.abort();
  await expect(run.client.getDirectory(abort.signal)).rejects.toThrow(
    'privacy_relayer_cancelled'
  );
  expect(run.fetcher).not.toHaveBeenCalled();
  jest.useFakeTimers();
  try {
    run.fetcher.mockImplementationOnce(() => new Promise(() => undefined));
    const timed = run.client.getDirectory();
    const rejection = expect(timed).rejects.toThrow('privacy_relayer_timeout');
    await jest.advanceTimersByTimeAsync(PRIVACY_RELAYER_TIMEOUT_MS);
    await rejection;
    expect(run.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test('exact percent arithmetic includes gas without floating-point rounding', () => {
  expect(
    quotePrivacyRelayerFee('eth-0.1', '0.3', '500000', '1000000000')
  ).toEqual({
    serviceFeeWei: '300000000000000',
    networkFeeWei: '500000000000000',
    feeWei: '800000000000000',
    receiveWei: '99200000000000000',
  });
  expect(
    quotePrivacyRelayerFee('eth-0.1', '0.000000000000000001', '1', '1')
      .serviceFeeWei
  ).toBe('1');
  expect(
    quotePrivacyRelayerFee('eth-100', '1.2300', '1', '1').serviceFeeWei
  ).toBe('1230000000000000000');
});

test.each([
  ['100', '1', '1'],
  ['99', '1000000000000000', '1'],
  ['-1', '1', '1'],
  ['1e-3', '1', '1'],
  ['0', '0', '1'],
  ['0', '1', '0'],
  ['0', '01', '1'],
  ['0', '1', `1${'0'.repeat(78)}`],
])('rejects unusable or malformed fee inputs %s %s %s', (fee, gas, price) => {
  expect(() => quotePrivacyRelayerFee('eth-0.1', fee, gas, price)).toThrow(
    /^privacy_relayer_/
  );
});

test('selected status is bounded to 64 KiB and network errors never expose endpoint details', async () => {
  const run = setup(),
    result = await run.client.getDirectory();
  run.fetcher.mockResolvedValueOnce(
    new Response(new Uint8Array(64 * 1024 + 1), {
      headers: { 'content-type': 'application/json' },
    })
  );
  await expect(
    run.client.checkRelayer(result, ensHash, 'eth-1')
  ).rejects.toThrow('privacy_relayer_data_invalid');
  run.fetcher.mockRejectedValueOnce(new Error('untrusted endpoint detail'));
  await expect(
    run.client.checkRelayer(result, ensHash, 'eth-1')
  ).rejects.toThrow('privacy_relayer_unavailable');
});

test('deadline and cancellation also bound a response whose body never finishes', async () => {
  const run = setup(),
    result = await run.client.getDirectory();
  run.fetcher.mockResolvedValueOnce(
    new Response(new ReadableStream(), {
      headers: { 'content-type': 'application/json' },
    })
  );
  const abort = new AbortController();
  const selection = run.client.checkRelayer(
    result,
    ensHash,
    'eth-1',
    abort.signal
  );
  const rejected = expect(selection).rejects.toThrow(
    'privacy_relayer_cancelled'
  );
  await Promise.resolve();
  abort.abort();
  await rejected;
  expect(run.fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
});

test('opaque and redirected results are rejected even if a custom fetcher reports HTTP 200', async () => {
  const run = setup();
  for (const override of [
    { type: 'opaque' },
    { redirected: true },
    { url: 'https://changed.example/relayers' },
  ]) {
    const fetched = response(directory());
    Object.entries(override).forEach(([key, value]) =>
      Object.defineProperty(fetched, key, { value })
    );
    run.fetcher.mockResolvedValueOnce(fetched);
    await expect(run.client.getDirectory()).rejects.toThrow(
      'privacy_relayer_data_invalid'
    );
  }
});

test('a selected entry is unavailable for another pool and old selections expire locally', async () => {
  const run = setup(),
    raw = directory();
  raw.relayers[0].supportedPools = ['eth-1'];
  run.fetcher.mockResolvedValueOnce(response(raw));
  const result = await run.client.getDirectory();
  await expect(
    run.client.checkRelayer(result, ensHash, 'eth-10')
  ).rejects.toThrow('privacy_relayer_unavailable');
  const only = status();
  only.instances.eth.instanceAddress = { '1': PRIVACY_POOLS[1].address };
  run.fetcher.mockResolvedValueOnce(response(only));
  const selected = await run.client.checkRelayer(result, ensHash, 'eth-1');
  run.time(NOW + PRIVACY_RELAYER_MAX_AGE_MS);
  expect(() => run.client.assertSelectionCurrent(selected)).toThrow(
    'privacy_relayer_stale'
  );
  expect(run.fetcher).toHaveBeenCalledTimes(2);
});
