import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Interface } from 'ethers/abi';
import { readSmartAccountFinancialState } from '../../../source/utils/smartAccount/financialReads.ts';
import { paliEntryPointInterface } from '../../../source/utils/smartAccount/contracts.ts';
import {
  PALI_INFRASTRUCTURE_METADATA_BY_ID,
  PALI_MULTICALL3_CANONICAL_ADDRESS,
} from '../../../source/utils/smartAccount/deploymentMetadata.ts';
const account = `0x${'11'.repeat(20)}`;
const source = readFileSync(
  new URL('../../../source/utils/smartAccount/deployment.ts', import.meta.url),
  'utf8'
);
const creation = source.match(
  /const multicall3Bytecode =\s*'(0x[0-9a-f]+)'/
)![1]!;
const runtime = `0x${creation.slice(2 + 0x20 * 2, 2 + (0x20 + 0xee0) * 2)}`;
const abi = new Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
  'function getEthBalance(address account) view returns (uint256)',
]);
const uint = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;
function fixture(failed = -1, wrongCode = false) {
  const calls: { method: string; params: readonly any[] }[] = [];
  const provider = {
    async send(method: string, params: readonly any[]) {
      calls.push({ method, params });
      if (method === 'eth_getCode') return wrongCode ? '0x6000' : runtime;
      if (method === 'eth_getBalance') return '0x64';
      const data = params[0].data;
      if (data.startsWith(abi.getFunction('aggregate3')!.selector)) {
        const rows = abi.decodeFunctionData('aggregate3', data)[0];
        assert.equal(rows.length, 3);
        assert(
          rows.every((row: { allowFailure: boolean }) => row.allowFailure)
        );
        assert(
          rows[1].callData.startsWith(
            abi.getFunction('getEthBalance')!.selector
          )
        );
        return abi.encodeFunctionResult('aggregate3', [
          [0n, 100n, 7n].map((value, index) => ({
            success: index !== failed,
            returnData: uint(value),
          })),
        ]);
      }
      if (
        data.startsWith(
          paliEntryPointInterface.getFunction('getNonce')!.selector
        )
      )
        return uint(0n);
      if (
        data.startsWith(
          paliEntryPointInterface.getFunction('balanceOf')!.selector
        )
      )
        return uint(7n);
      throw new Error('Unexpected read');
    },
  };
  return { provider, calls };
}
test('fixed financial getters use one verified pending aggregate', async () => {
  const f = fixture();
  const result = await readSmartAccountFinancialState(f.provider, 1, account);
  assert.equal(result.nonce, '0');
  assert.equal(result.balance.toString(), '100');
  assert.equal(result.deposit.toString(), '7');
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ['eth_getCode', 'eth_call']
  );
  assert.equal(
    f.calls[0]!.params[0],
    PALI_INFRASTRUCTURE_METADATA_BY_ID.multicall3.address
  );
  assert(f.calls.every((call) => call.params[1] === 'pending'));
});
test('one failed aggregate member retries only its matching raw pending getter', async () => {
  const f = fixture(1);
  const result = await readSmartAccountFinancialState(f.provider, 1, account);
  assert.equal(result.balance.toString(), '100');
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ['eth_getCode', 'eth_call', 'eth_getBalance']
  );
});
test('unknown runtime falls back to independent raw getters on pending', async () => {
  const f = fixture(-1, true);
  await readSmartAccountFinancialState(f.provider, 1, account);
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ['eth_getCode', 'eth_getCode', 'eth_call', 'eth_getBalance', 'eth_call']
  );
  assert.equal(f.calls[1]!.params[0], PALI_MULTICALL3_CANONICAL_ADDRESS);
  assert(f.calls.every((call) => call.params[1] === 'pending'));
});
test('a complete malformed aggregate retries each fixed getter and rejects wrong nonce lane', async () => {
  const f = fixture();
  const original = f.provider.send.bind(f.provider);
  f.provider.send = async (method, params) =>
    method === 'eth_call' &&
    params[0].data.startsWith(abi.getFunction('aggregate3')!.selector)
      ? '0x12'
      : original(method, params);
  assert.equal(
    (await readSmartAccountFinancialState(f.provider, 1, account)).nonce,
    '0'
  );
  await assert.rejects(
    readSmartAccountFinancialState(f.provider, 1, account, 1n),
    /nonce key response/
  );
  await assert.rejects(
    readSmartAccountFinancialState(f.provider, 1, account, 1n << 192n),
    /nonce key/
  );
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
  assert.deepEqual(f.calls.map(call => call.method), ['eth_getCode','eth_call']);
  await assert.rejects(escaped.readSmartAccountFinancialState(0n), /phase ended/);
  await state.withReadPhase(async phase => { await phase.readNonce(0n); });
  assert.equal(f.calls.length, 4);
  current = false;
  await assert.rejects(state.withReadPhase(async phase => phase.readNonce(0n)), /revoked/);
});
