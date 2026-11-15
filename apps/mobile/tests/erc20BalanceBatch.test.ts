import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Interface } from 'ethers/abi';
import { keccak256 } from 'ethers/crypto';
import {
  createErc20BalanceBatch,
  ERC20_MULTICALL_RUNTIME_HASH,
} from '../../../source/shared/erc20BalanceBatch.ts';
import { PALI_MULTICALL3_CANONICAL_ADDRESS } from '../../../source/utils/smartAccount/deploymentMetadata.ts';

const source = readFileSync(
  new URL('../../../source/utils/smartAccount/deployment.ts', import.meta.url),
  'utf8'
);
const creation = source.match(
  /const multicall3Bytecode =\s*'(0x[0-9a-f]+)'/
)![1]!;
const runtime = `0x${creation.slice(2 + 0x20 * 2, 2 + (0x20 + 0xee0) * 2)}`;
const calls = [
  { target: `0x${'11'.repeat(20)}`, data: '0x313ce567' },
  {
    target: `0x${'11'.repeat(20)}`,
    data: `0x70a08231${'00'.repeat(12)}${'22'.repeat(20)}`,
  },
];
const abi = new Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
]);

test('Multicall identity equals the runtime in the bundled deployment constructor', () => {
  assert.equal(keccak256(runtime), ERC20_MULTICALL_RUNTIME_HASH);
});

test('verified getter aggregation preserves the block, isolates failed members and expires its capability', async () => {
  let clock = 1;
  const batch = createErc20BalanceBatch(() => clock);
  const reads: { method: string; params: readonly unknown[] }[] = [];
  const reader = {
    async read(method: 'eth_getCode' | 'eth_call', params: readonly unknown[]) {
      reads.push({ method, params });
      if (method === 'eth_getCode') return runtime;
      assert.equal(
        (params[0] as { to: string }).to,
        PALI_MULTICALL3_CANONICAL_ADDRESS
      );
      const decoded = abi.decodeFunctionData(
        'aggregate3',
        (params[0] as { data: string }).data
      )[0];
      assert(
        decoded.every((call: { allowFailure: boolean }) => call.allowFailure)
      );
      return abi.encodeFunctionResult('aggregate3', [
        [
          { success: true, returnData: '0x1234' },
          { success: false, returnData: '0x' },
        ],
      ]);
    },
    async readMany(
      requests: readonly { method: 'eth_call'; params: readonly unknown[] }[]
    ) {
      return Promise.all(
        requests.map(async (request) => ({
          status: 'fulfilled' as const,
          value: await this.read(request.method, request.params),
        }))
      );
    },
  };
  const result = await batch(reader, calls, '0x123');
  assert.equal(result[0]!.status, 'fulfilled');
  assert.equal(result[1]!.status, 'rejected');
  assert(reads.every((read) => read.params[1] === '0x123'));
  reads.length = 0;
  await batch(reader, calls, '0x124');
  assert.deepEqual(
    reads.map((read) => read.method),
    ['eth_call']
  );
  clock += 30_000;
  reads.length = 0;
  await batch(reader, calls, '0x125');
  assert.deepEqual(
    reads.map((read) => read.method),
    ['eth_getCode', 'eth_call']
  );
});

test('unrecognized runtime uses bounded direct getters at the same block', async () => {
  const batch = createErc20BalanceBatch();
  let probes = 0;
  const direct = [
    { status: 'fulfilled' as const, value: '0x01' },
    { status: 'rejected' as const, reason: new Error('revert') },
  ];
  const reader = {
    async read(method: string) {
      assert.equal(method, 'eth_getCode');
      probes++;
      return '0x6000';
    },
    async readMany(
      requests: readonly { method: string; params: readonly unknown[] }[]
    ) {
      assert.deepEqual(
        requests,
        calls.map((call) => ({
          method: 'eth_call',
          params: [{ to: call.target, data: call.data }, '0x123'],
        }))
      );
      return direct;
    },
  };
  assert.equal(await batch(reader, calls, '0x123'), direct);
  assert.equal(probes, 2);
});

test('arbitrary calls and unanchored selectors never enter aggregation', async () => {
  let touched = false;
  const reader = {
    async read() {
      touched = true;
      return '0x';
    },
    async readMany() {
      touched = true;
      return [];
    },
  };
  await assert.rejects(
    createErc20BalanceBatch()(
      reader,
      [{ ...calls[0]!, data: '0xa9059cbb' }],
      '0x1'
    ),
    /Invalid token balance getter/
  );
  await assert.rejects(
    createErc20BalanceBatch()(reader, calls, 'latest'),
    /Invalid token balance block/
  );
  assert.equal(touched, false);
});
