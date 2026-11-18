import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionSimulationUnsupportedError } from '../../../source/utils/smartAccount/executionSimulationError.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { NativeSmartAccountOperation, type NativeSmartAccountOperationHost } from '../src/smartAccount/operation.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';

for (const code of [-32601, 4200, -32000]) test(`native simulation classifies RPC code ${code} without fallback`, async () => {
  const methods: string[] = [];
  const rpc = new EvmTransferReadRpc('ethereum', { fetch: async (_url, init) => {
    const row = JSON.parse(String(init.body));
    methods.push(row.method);
    return Response.json({ jsonrpc: '2.0', id: row.id, ...(row.method === 'eth_chainId'
      ? { result: '0x1' } : { error: { code, message: 'Node failure' } }) });
  } });
  await assert.rejects(rpc.smartAccountRead('eth_simulateV1', [{}, 'latest'], new AbortController().signal, () => undefined),
    error => code === -32000
      ? (error as { code: string }).code === 'INVALID_RESPONSE'
      : error instanceof ExecutionSimulationUnsupportedError);
  assert.deepEqual(methods, ['eth_chainId', 'eth_simulateV1']);
});

test('cancelled simulation keeps cancellation instead of publishing method-unavailable', async () => {
  const controller = new AbortController();
  const rpc = new EvmTransferReadRpc('ethereum', { fetch: async (_url, init) => {
    const row = JSON.parse(String(init.body));
    if (row.method === 'eth_simulateV1') controller.abort();
    return Response.json({ jsonrpc: '2.0', id: row.id, ...(row.method === 'eth_chainId'
      ? { result: '0x1' } : { error: { code: -32601, message: 'Method unavailable' } }) });
  } });
  await assert.rejects(rpc.smartAccountRead('eth_simulateV1', [{}, 'latest'], controller.signal, () => undefined), { code: 'CANCELLED' });
});

for (const retired of [false, true]) test(`native operation only publishes the supported error in its current context, retired=${retired}`, async () => {
  let current = true;
  const error = new ExecutionSimulationUnsupportedError();
  const host: NativeSmartAccountOperationHost = {
    account: '0x' + '11'.repeat(20), network: getNativeNetwork('ethereum'),
    intent: { kind: 'native-transfer', recipient: '0x' + '22'.repeat(20), amountUnits: '1' },
    authorizationExpiresAt: Date.now() + 60_000, background() {},
    assertCurrent() { assert(current); },
    async prepare() { if (retired) current = false; throw error; },
    async sign() { assert.fail('Unavailable simulation must not reach signing'); },
    async submit() { assert.fail('Unavailable simulation must not reach submission'); },
  };
  const model = new NativeSmartAccountOperation(host);
  try {
    await model.prepare();
    assert.equal(model.getSnapshot().phase, 'failed');
    assert.equal(model.getSnapshot().error === error.message, !retired);
  } finally { await model.dispose(); }
});
