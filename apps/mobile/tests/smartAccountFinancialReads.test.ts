import assert from 'node:assert/strict';
import test from 'node:test';
import { readSmartAccountFinancialState } from '../../../source/utils/smartAccount/financialReads.ts';
import { paliEntryPointInterface } from '../../../source/utils/smartAccount/contracts.ts';
const account = `0x${'11'.repeat(20)}`;
const uint = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;
function fixture() {
  const calls: { method: string; params: readonly any[] }[] = [];
  const provider = {
    async send(method: string, params: readonly any[]) {
      calls.push({ method, params });
      if (method === 'eth_getBalance') return '0x64';
      const parsed = paliEntryPointInterface.parseTransaction({ data: params[0].data });
      if (parsed?.name === 'getNonce') return uint(0n);
      if (parsed?.name === 'balanceOf') return uint(7n);
      throw new Error('Unexpected read');
    },
  };
  return { provider, calls };
}
test('three fixed pending financial getters enter the same read group', async () => {
  const f = fixture();
  const result = await readSmartAccountFinancialState(f.provider, 1, account);
  assert.equal(result.nonce, '0');
  assert.equal(result.balance.toString(), '100');
  assert.equal(result.deposit.toString(), '7');
  assert.deepEqual(f.calls.map(call => call.method), ['eth_call', 'eth_getBalance', 'eth_call']);
  assert(f.calls.every(call => call.params[1] === 'pending'));
});
test('malformed member and nonce lane reject the financial observation', async () => {
  const f = fixture();
  await assert.rejects(readSmartAccountFinancialState(f.provider, 1, account, 1n), /nonce key response/);
  await assert.rejects(readSmartAccountFinancialState(f.provider, 1, account, 1n << 192n), /nonce key/);
  const original = f.provider.send.bind(f.provider);
  f.provider.send = async (method, params) => method === 'eth_getBalance' ? '0x00' : original(method, params);
  await assert.rejects(readSmartAccountFinancialState(f.provider, 1, account), /Invalid smart account balance/);
});
test('native spendability reuses the phase financial observation with the operation nonce lane', async () => {
  const { assertSmartAccountNativeSpendability } = await import(
    '../../../source/utils/smartAccount/nativeSpendability.ts'
  );
  const { BigNumber } = await import('../../../source/utils/ethersV6Compat.ts');
  const { ERC7579_MODE_SINGLE_DEFAULT, SMART_ACCOUNT_ZERO_GAS_FEES } =
    await import('../../../source/utils/smartAccount/account.ts');
  const { paliSmartAccountInterface } = await import(
    '../../../source/utils/smartAccount/contracts.ts'
  );
  const nonce = 7n << 64n;
  let calls = 0;
  const operation = {
    sender: account,
    nonce: nonce.toString(),
    initCode: '0x',
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [
      ERC7579_MODE_SINGLE_DEFAULT,
      `0x${'22'.repeat(20)}${5n.toString(16).padStart(64, '0')}`,
    ]),
    accountGasLimits: '0x' + '00'.repeat(32),
    preVerificationGas: '0',
    gasFees: SMART_ACCOUNT_ZERO_GAS_FEES,
    paymasterAndData: '0x',
    signature: '0x',
  };
  await assertSmartAccountNativeSpendability({
    chainId: 1,
    userOperation: operation,
    provider: {
      async readSmartAccountFinancialState(key: bigint) {
        calls++;
        assert.equal(key, 7n);
        return {
          nonce: nonce.toString(),
          balance: BigNumber.from(10),
          deposit: BigNumber.from(0),
        };
      },
      getBalance() {
        throw new Error('Duplicate raw balance read');
      },
    },
    assertCurrent() {},
  });
  assert.equal(calls, 1);
});

test('financial observations share within one owned phase and retire with it', async () => {
  const { createSmartAccountPendingState } = await import('../../../source/utils/smartAccount/pendingState.ts');
  const f = fixture();
  let current = true;
  const provider = { ...f.provider,
    verifyConfiguredChainId: async () => { if (!current) throw new Error('revoked'); },
  };
  const state = createSmartAccountPendingState(provider, {
    profileId: '0x' + '33'.repeat(32), read: async () => [],
  }, 1, account, () => { if (!current) throw new Error('revoked'); });
  let escaped: any;
  await state.withReadPhase(async phase => {
    escaped = phase.provider;
    assert.equal(await phase.readNonce(0n), '0');
    assert.equal((await phase.provider.readSmartAccountFinancialState(0n)).balance.toString(), '100');
  });
  assert.deepEqual(f.calls.map(call => call.method), ['eth_call', 'eth_getBalance', 'eth_call']);
  await assert.rejects(escaped.readSmartAccountFinancialState(0n), /phase ended/);
  await state.withReadPhase(async phase => { await phase.readNonce(0n); });
  assert.equal(f.calls.length, 4);
  current = false;
  await assert.rejects(state.withReadPhase(async phase => phase.readNonce(0n)), /revoked/);
});

test('zero-value pending admission fetches only its nonce and retires at the phase boundary', async () => {
  const { createSmartAccountPendingState } = await import('../../../source/utils/smartAccount/pendingState.ts');
  const { ERC7579_MODE_SINGLE_DEFAULT } = await import('../../../source/utils/smartAccount/account.ts');
  const { paliSmartAccountInterface } = await import('../../../source/utils/smartAccount/contracts.ts');
  const f = fixture();
  const provider = { ...f.provider, verifyConfiguredChainId: async () => undefined };
  const state = createSmartAccountPendingState(provider, {
    profileId: '0x' + '33'.repeat(32), read: async () => [],
  }, 1, account, () => undefined);
  const operation = { sender: account, nonce: '0', callData: paliSmartAccountInterface.encodeFunctionData('execute', [
    ERC7579_MODE_SINGLE_DEFAULT, `0x${'22'.repeat(20)}${'0'.repeat(64)}`,
  ]) } as Parameters<typeof state.assertNonce>[0];
  await state.withReadPhase(async phase => {
    await phase.assertNonce(operation);
    await phase.readNonce(0n);
  });
  assert.equal(f.calls.length, 1);
  assert.equal(paliEntryPointInterface.parseTransaction({ data: f.calls[0]!.params[0].data })?.name, 'getNonce');
  await state.withReadPhase(async phase => phase.assertNonce(operation));
  assert.equal(f.calls.length, 2);
});


test('the actual SDK carries three pending getters in one HTTP envelope per phase', async () => {
  const { JsonRpcReadClient } = await import('@sidhujag/sysweb3-keyring/cjs/rpc-read-client.js');
  const { withEvmReadPhase } = await import('../../../source/shared/evmReadPhase.ts');
  const posts: { method: string; params: readonly unknown[] }[][] = [];
  const client = new JsonRpcReadClient('https://financial.invalid', { fetch: async (_url, init) => {
    const payload = JSON.parse(String(init.body));
    assert(Array.isArray(payload));
    posts.push(payload);
    return Response.json(payload.map(request => ({ jsonrpc: '2.0', id: request.id,
      result: request.method === 'eth_getBalance' ? '0x64' : uint(request.params[0].data.startsWith(paliEntryPointInterface.getFunction('getNonce')!.selector) ? 0n : 7n),
    })));
  } });
  const provider = { send: client.read.bind(client), readMany: client.readMany.bind(client), verifyConfiguredChainId: async () => undefined };
  try {
    const result = await withEvmReadPhase(provider, () => undefined, phase => readSmartAccountFinancialState(phase, 1, account));
    assert.equal(result.balance.toString(), '100');
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0]!.map(request => request.method), ['eth_call', 'eth_getBalance', 'eth_call']);
    assert(posts[0]!.every(request => request.params[1] === 'pending'));
  } finally { client.destroy(); }
});

test('the actual SDK batches a primed authenticated nonce, financial state and quote header in one POST', async () => {
  const { JsonRpcReadClient } = await import('@sidhujag/sysweb3-keyring/cjs/rpc-read-client.js');
  const { createSmartAccountPendingState } = await import('../../../source/utils/smartAccount/pendingState.ts');
  const { prepareEvmDappQuote } = await import('../../../source/shared/evmDappPreparation.ts');
  const { NATIVE_EVM_FEE_FUNDING } = await import('../../../source/shared/evmFeeApproval.ts');
  const { buildSmartAccountUserOperation, encodeERC7579Executions, encodeSmartAccountGasFees } = await import('../../../source/utils/smartAccount/account.ts');
  const { paliSmartAccountInterface } = await import('../../../source/utils/smartAccount/contracts.ts');
  let current = 1n, loads = 0;
  const payer = '0x' + '22'.repeat(20), posts: any[][] = [];
  const client = new JsonRpcReadClient('https://financial.invalid', { fetch: async (_url, init) => {
    const raw = JSON.parse(String(init.body)), requests = Array.isArray(raw) ? raw : [raw];
    posts.push(requests);
    const replies = requests.map(request => ({ jsonrpc: '2.0', id: request.id, result:
      request.method === 'eth_getBlockByNumber' ? { number: '0x10', hash: '0x' + '44'.repeat(32), gasLimit: '0x100000', baseFeePerGas: '0x1' }
      : request.method === 'eth_estimateGas' ? '0x5208'
      : request.method === 'eth_getBalance' ? '0xde0b6b3a7640000'
      : uint(request.params[0].data.startsWith(paliEntryPointInterface.getFunction('getNonce')!.selector) ? current : 1000000000000000000n) }));
    return Response.json(Array.isArray(raw) ? replies : replies[0]);
  } });
  const provider = { send: client.read.bind(client), readMany: client.readMany.bind(client), verifyConfiguredChainId: async () => undefined };
  const pending = createSmartAccountPendingState(provider, { profileId: '0x' + '33'.repeat(32), read: async () => [],
    readAuthorizations: async () => { loads++; await Promise.resolve(); return [{ account, chainId: '1', operationHash: '0x' + '55'.repeat(32), operationNonce: (current - 1n).toString() }]; },
  }, 1, account, () => undefined);
  const calls = encodeERC7579Executions([{ target: payer, value: '1', data: '0x' }]);
  try {
    for (let phase = 0; phase < 2; phase++) {
      const operation = buildSmartAccountUserOperation({ sender: account, nonce: current.toString(),
        callData: paliSmartAccountInterface.encodeFunctionData('execute', [calls.mode, calls.executionCalldata]),
        gasFees: encodeSmartAccountGasFees({ maxFeePerGas: 1, maxPriorityFeePerGas: 1 }) });
      const before = posts.length;
      await pending.withReadPhase(async owned => Promise.all([
        owned.assertNonce(operation),
        prepareEvmDappQuote({ from: payer, to: account, value: '0', data: '0x1234', maxFeePerGas: '3', maxPriorityFeePerGas: '1' }, {
          chainId: '1', scope: 'owned', funding: NATIVE_EVM_FEE_FUNDING, gasPolicy: { kind: 'estimate' }, feePolicy: 'fixed',
          assertCurrent() {}, now: () => 1, read: (method, params) => owned.provider.send(method, [...params]),
          verifyChain: async () => { await owned.provider.verifyConfiguredChainId(true); }, verifyBlock: async () => undefined,
          nonce: async () => ({ nonce: 0n, state: 'pending' as const }), balance: async () => 1000000000000000000n,
          fees: async () => { throw new Error('No recommendation needed'); },
        }),
      ]));
      assert.equal(posts[before]!.length, 4);
      assert.deepEqual(posts[before]!.map(row => row.method).sort(), ['eth_call', 'eth_call', 'eth_getBalance', 'eth_getBlockByNumber'].sort());
      assert.equal(posts.length - before, 2, 'one grouped observation POST and one estimate POST');
      current++;
    }
    assert.equal(loads, 2);
  } finally { client.destroy(); }
});

test('actual native full admission batches the nonce and spendability with two chain probes', async () => {
  const { createNativeNetwork } = await import('../src/custody/networkContext.ts');
  const { EvmTransferReadRpc } = await import('../src/custody/evmTransferReadRpc.ts');
  const { createNativeSmartAccountProvider } = await import('../src/smartAccount/provider.ts');
  const { createSmartAccountPendingState } = await import('../../../source/utils/smartAccount/pendingState.ts');
  const { assertSmartAccountSpendability } = await import('../../../source/utils/smartAccount/assetSpendability.ts');
  const { ERC7579_MODE_SINGLE_DEFAULT, SMART_ACCOUNT_ZERO_GAS_FEES } = await import('../../../source/utils/smartAccount/account.ts');
  const { paliSmartAccountInterface } = await import('../../../source/utils/smartAccount/contracts.ts');
  const network = createNativeNetwork({ id: 'financial', chainId: '1', name: 'Financial', kind: 'evm', rpcUrl: 'https://financial.invalid', slip44: 60, symbol: 'ETH', decimals: 18, testnet: true });
  const posts: string[][] = [];
  const rpc = new EvmTransferReadRpc(network, { fetch: async (_url, init) => {
    const input = JSON.parse(String(init.body));
    const rows = Array.isArray(input) ? input : [input];
    posts.push(rows.map(row => row.method));
    const output = rows.map(row => ({ jsonrpc: '2.0', id: row.id, result: row.method === 'eth_chainId' ? '0x1'
      : row.method === 'eth_getBalance' ? '0x64' : uint(row.params[0].data.startsWith(paliEntryPointInterface.getFunction('getNonce')!.selector) ? 0n : 7n) }));
    return Response.json(Array.isArray(input) ? output : output[0]);
  } });
  const provider = createNativeSmartAccountProvider(network, rpc, new AbortController().signal, () => undefined);
  const pending = createSmartAccountPendingState(provider, { profileId: '0x' + '33'.repeat(32), read: async () => [] }, 1, account, () => undefined);
  const operation = { sender: account, nonce: '0', initCode: '0x',
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [ERC7579_MODE_SINGLE_DEFAULT, `0x${'22'.repeat(20)}${5n.toString(16).padStart(64, '0')}`]),
    accountGasLimits: '0x' + '00'.repeat(32), gasFees: SMART_ACCOUNT_ZERO_GAS_FEES, preVerificationGas: '0', paymasterAndData: '0x', signature: '0x',
  };
  await pending.withReadPhase(async phase => {
    await phase.assertNonce(operation);
    await assertSmartAccountSpendability({ provider: phase.provider, chainId: 1, userOperation: operation, assertCurrent: () => undefined });
  });
  assert.deepEqual(posts, [['eth_chainId'], ['eth_call', 'eth_getBalance'], ['eth_chainId']]);
});


test('zero-prefund financial reuse never hides a later required deposit', async () => {
  const { createSmartAccountPendingState } = await import('../../../source/utils/smartAccount/pendingState.ts');
  const f = fixture();
  const pending = createSmartAccountPendingState({ ...f.provider, verifyConfiguredChainId: async () => undefined }, {
    profileId: '0x' + '33'.repeat(32), read: async () => [],
  }, 1, account, () => undefined);
  await pending.withReadPhase(async phase => {
    const first = await phase.provider.readSmartAccountFinancialState(0n, false);
    assert.equal(first.deposit.toString(), '0');
    assert.equal(f.calls.length, 2);
    const second = await phase.provider.readSmartAccountFinancialState(0n, true);
    assert.equal(second.deposit.toString(), '7');
    assert.equal(f.calls.length, 3);
    assert.equal(f.calls.filter(row => row.method === 'eth_getBalance').length, 1);
  });
});

test('native shared phase keeps the final parent check fresh after an exact simulation', async () => {
  const { createNativeNetwork } = await import('../src/custody/networkContext.ts');
  const { EvmTransferReadRpc } = await import('../src/custody/evmTransferReadRpc.ts');
  const { createNativeSmartAccountProvider } = await import('../src/smartAccount/provider.ts');
  const { withEvmReadPhase, readFreshEvmState } = await import('../../../source/shared/evmReadPhase.ts');
  const network = createNativeNetwork({ id: 'fresh-simulation', chainId: '1', name: 'Fresh simulation', kind: 'evm', rpcUrl: 'https://fresh-simulation.invalid', slip44: 60, symbol: 'ETH', decimals: 18, testnet: true });
  const initial = '0x' + '11'.repeat(32), replacement = '0x' + '22'.repeat(32);
  let canonical = initial, blockReads = 0;
  const rpc = new EvmTransferReadRpc(network, { fetch: async (_url, init) => {
    const input = JSON.parse(String(init.body));
    const rows = Array.isArray(input) ? input : [input];
    const replies = rows.map(row => {
      if (row.method === 'eth_chainId') return { jsonrpc: '2.0', id: row.id, result: '0x1' };
      if (row.method === 'eth_simulateV1') { canonical = replacement; return { jsonrpc: '2.0', id: row.id, result: [] }; }
      assert.equal(row.method, 'eth_getBlockByNumber');
      blockReads++;
      return { jsonrpc: '2.0', id: row.id, result: { number: '0xa', hash: canonical } };
    });
    return Response.json(Array.isArray(input) ? replies : replies[0]);
  } });
  const provider = createNativeSmartAccountProvider(network, rpc, new AbortController().signal, () => undefined);
  await withEvmReadPhase(provider, () => undefined, async phase => {
    assert.equal((await phase.send('eth_getBlockByNumber', ['0xa', false])).hash, initial);
    await phase.send('eth_simulateV1', [{ blockStateCalls: [{ calls: [] }] }, '0xa']);
    assert.equal((await readFreshEvmState(phase, 'eth_getBlockByNumber', ['0xa', false])).hash, replacement);
  });
  assert.equal(blockReads, 2);
});
