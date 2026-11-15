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
  assert.equal(f.calls.length, 6);
  current = false;
  await assert.rejects(state.withReadPhase(async phase => phase.readNonce(0n)), /revoked/);
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
