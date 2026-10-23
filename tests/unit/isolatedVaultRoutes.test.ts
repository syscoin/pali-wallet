jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');

import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../../e2e/harness/isolatedVaultFixture';

import type { BrowserContext, Route } from '@playwright/test';

const FEED =
  'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json';
const LOCAL_ORIGIN = 'http://127.0.0.1:19999';
type GetResolver = Parameters<typeof installIsolatedVaultRoutes>[3];
type RouteHandler = (route: Route) => Promise<void>;
let fixture: ReturnType<typeof createIsolatedVaultFixture>;

beforeAll(() => {
  fixture = createIsolatedVaultFixture();
});

const makeRoute = (url = FEED, method = 'GET', json?: unknown) => ({
  request: () => ({
    url: () => url,
    method: () => method,
    postDataJSON: () => {
      if (json === undefined) throw new Error('No JSON body');
      return json;
    },
  }),
  abort: jest.fn().mockResolvedValue(undefined),
  continue: jest.fn().mockResolvedValue(undefined),
  fulfill: jest.fn().mockResolvedValue(undefined),
});

const install = async (
  resolver?: GetResolver,
  duringRegistration?: ReturnType<typeof makeRoute>
) => {
  let handler!: RouteHandler;
  const context = {
    route: jest.fn(async (_pattern: string, next: RouteHandler) => {
      handler = next;
      // A startup request can arrive as soon as the first handler is active,
      // before the caller regains control after awaiting registration.
      if (duringRegistration)
        await handler(duringRegistration as unknown as Route);
    }),
  };
  const audit = await installIsolatedVaultRoutes(
    context as unknown as BrowserContext,
    fixture,
    LOCAL_ORIGIN,
    resolver
  );
  return {
    ...audit,
    context,
    dispatch: (route: ReturnType<typeof makeRoute>) =>
      handler(route as unknown as Route),
  };
};

it('answers an exact auxiliary GET atomically with the first deny handler', async () => {
  const route = makeRoute();
  const resolver = jest.fn((url: URL) => (url.href === FEED ? [] : undefined));
  const audit = await install(resolver, route);
  expect(audit.context.route).toHaveBeenCalledTimes(1);
  expect(audit.context.route).toHaveBeenCalledWith(
    '**/*',
    expect.any(Function)
  );
  expect(resolver).toHaveBeenCalledTimes(1);
  expect(resolver.mock.calls[0][0].href).toBe(FEED);
  expect(route.fulfill).toHaveBeenCalledWith({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: '[]',
  });
  expect(route.abort).not.toHaveBeenCalled();
  expect(audit.reads).toEqual(['synthetic-get:' + FEED]);
  expect(audit.deniedWrites).toEqual([]);
});

it('preserves explicit empty, false, zero and null GET responses', async () => {
  for (const body of [[], '', false, 0, null]) {
    const route = makeRoute();
    const audit = await install(() => body);
    await audit.dispatch(route);
    expect(route.fulfill).toHaveBeenCalledWith(
      expect.objectContaining({ body: JSON.stringify(body) })
    );
    expect(route.abort).not.toHaveBeenCalled();
  }
});

it('still aborts unmatched GET origins, paths and query parameters', async () => {
  const resolver = jest.fn((url: URL) => (url.href === FEED ? [] : undefined));
  const audit = await install(resolver);
  for (const url of [
    FEED + '?unexpected=1',
    FEED.replace('domains.json', 'other.json'),
    FEED.replace('raw.githubusercontent.com', 'foreign.invalid'),
  ]) {
    const route = makeRoute(url);
    await audit.dispatch(route);
    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(route.fulfill).not.toHaveBeenCalled();
    expect(route.continue).not.toHaveBeenCalled();
  }
  expect(resolver).toHaveBeenCalledTimes(3);
  expect(audit.reads).toEqual([]);
  expect(audit.deniedWrites).toEqual([]);
});

it('never asks the GET resolver to handle POST or write requests', async () => {
  const resolver = jest.fn(() => ({ mustNotBeReturned: true }));
  const audit = await install(resolver);
  const requests = [
    makeRoute(FEED, 'POST'),
    makeRoute('https://blockbook-dev.syscoin.org/api/v2/sendtx/test'),
    makeRoute('https://rpc.tanenbaum.io/', 'POST', {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendTransaction',
      params: [],
    }),
    makeRoute('https://rpc.tanenbaum.io/', 'POST', [
      { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'wallet_sendCalls', params: [] },
    ]),
    makeRoute(FEED, 'GET', {
      jsonrpc: '2.0',
      id: 1,
      method: 'sys_signTransaction',
      params: [],
    }),
  ];
  for (const route of requests) {
    await audit.dispatch(route);
    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(route.fulfill).not.toHaveBeenCalled();
    expect(route.continue).not.toHaveBeenCalled();
  }
  expect(resolver).not.toHaveBeenCalled();
  expect(audit.deniedWrites).toHaveLength(4);
  expect(audit.reads).toEqual([]);
});

it('keeps the default EVM read fixture unchanged and does not use the GET resolver', async () => {
  const resolver = jest.fn(() => ({ mustNotBeReturned: true }));
  const audit = await install(resolver);
  const route = makeRoute('https://rpc.tanenbaum.io/', 'POST', {
    jsonrpc: '2.0',
    id: 7,
    method: 'eth_chainId',
    params: [],
  });
  await audit.dispatch(route);
  expect(route.fulfill).toHaveBeenCalledWith(
    expect.objectContaining({
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, result: '0x1644' }),
    })
  );
  expect(resolver).not.toHaveBeenCalled();
  expect(audit.reads).toEqual(['synthetic-evm:eth_chainId']);
  expect(audit.deniedWrites).toEqual([]);
});

it('keeps existing UTXO reads and unknown GET denial when no resolver is supplied', async () => {
  const audit = await install();
  const route = makeRoute(
    `https://blockbook-dev.syscoin.org/api/v2/address/${fixture.watchAddress}`
  );
  await audit.dispatch(route);
  expect(route.fulfill).toHaveBeenCalledWith(
    expect.objectContaining({
      body: JSON.stringify({
        address: fixture.watchAddress,
        balance: '0',
        unconfirmedBalance: '0',
        totalReceived: '0',
        totalSent: '0',
        txs: 0,
        unconfirmedTxs: 0,
        usedTokens: 0,
        tokens: [],
        tokensAsset: [],
      }),
    })
  );
  const unknown = makeRoute(FEED);
  await audit.dispatch(unknown);
  expect(unknown.abort).toHaveBeenCalledWith('blockedbyclient');
  expect(unknown.fulfill).not.toHaveBeenCalled();
  expect(audit.deniedWrites).toEqual([]);
});
