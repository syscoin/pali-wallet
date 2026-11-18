import {
  assertRpcCapabilityProbes,
  assertRpcTrafficBudget,
  countRpcTraffic,
  type RpcTraffic,
} from '../../e2e/harness/rpcTrafficBudget';

const row = (
  methods = 1,
  probe = false,
  started = 0,
  finished = 10
): RpcTraffic => ({
  started,
  finished,
  methods: Array(methods).fill('eth_call'),
  requestBytes: 100,
  responseBytes: 200,
  batchCapabilityProbe: probe,
});

test('counts refused probes in all attempted traffic and rejects total overflow', () => {
  const rows = [row(), row(3, true)];
  expect(countRpcTraffic(rows)).toEqual({
    httpRequests: 2,
    rpcMethods: 4,
    requestBytes: 200,
    responseBytes: 400,
  });
  expect(() =>
    assertRpcTrafficBudget(
      rows,
      { methods: 3, posts: 2, requestBytes: 200, responseBytes: 400 },
      'whole journey'
    )
  ).toThrow('whole journey');
  expect(() =>
    assertRpcTrafficBudget(
      rows,
      { methods: 4, posts: 2, requestBytes: 200, responseBytes: 400 },
      'whole journey'
    )
  ).not.toThrow();
});

test('allows four concurrent probes but rejects extra or sequential probe traffic', () => {
  expect(() =>
    assertRpcCapabilityProbes([row(3, true), row(2, true, 3)], 'phase')
  ).not.toThrow();
  expect(() =>
    assertRpcCapabilityProbes(
      Array.from({ length: 5 }, () => row(2, true)),
      'phase'
    )
  ).toThrow();
  expect(() =>
    assertRpcCapabilityProbes([row(3, true), row(2, true, 11)], 'phase')
  ).toThrow();
  expect(() => assertRpcCapabilityProbes([row(41, true)], 'phase')).toThrow();
});

test('rejects incomplete or unreadable responses while counting failed requests', () => {
  const limits = {
    methods: 1,
    posts: 1,
    requestBytes: 100,
    responseBytes: 200,
  };
  for (const incomplete of [
    { ...row(), finished: undefined },
    { ...row(), responseBytes: undefined },
    { ...row(), responseFailure: 'Body unavailable' },
  ]) {
    expect(() =>
      assertRpcTrafficBudget([incomplete], limits, 'journey')
    ).toThrow('incomplete response accounting');
  }
  const failed = {
    ...row(),
    responseBytes: undefined,
    requestFailure: 'Aborted',
  };
  expect(() =>
    assertRpcTrafficBudget([failed], limits, 'journey')
  ).not.toThrow();
  expect(countRpcTraffic([failed])).toEqual({
    httpRequests: 1,
    rpcMethods: 1,
    requestBytes: 100,
    responseBytes: 0,
  });
});
