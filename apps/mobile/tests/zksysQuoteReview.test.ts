import { emptyNoncePlanner } from './noncePlannerFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { NativeTransfers } from '../src/custody/transfers.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';

const from = '0x1111111111111111111111111111111111111111';
const to = '0x2222222222222222222222222222222222222222';
function fixture() {
  let baseFee: unknown = '0x64',
    nonce: unknown = '0x0';
  let signatures = 0,
    writes = 0,
    broadcasts = 0,
    locks = 0;
  const state: CustodySnapshot = {
    phase: 'ready',
    revision: 1,
    presence: 'existing',
    backup: 'confirmed',
    account: { address: from, network: 'zksys-testnet' },
    error: null,
  };
  const source = {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    lock: () => {
      locks++;
    },
  };
  const runtime = {
    async authenticateOperation(_credential: unknown, check: () => void) { check(); },
    async journal() {
      return {
        planAutomaticNonce: emptyNoncePlanner,
        async load() {
          return null;
        },
        async assertSpendingNonce(value: number) {
          assert.equal(value, 0);
        },
        async saveSigned() {
          writes++;
          throw Error('unexpected write');
        },
      };
    },
    async sign() {
      signatures++;
      throw Error('unexpected signature');
    },
    assertUnlocked() {
      throw Error('unexpected authorization');
    },
  };
  const rpc = new NativeTransferRpc({
    networkId: 'zksys-testnet',
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      let result: unknown;
      switch (body.method) {
        case 'eth_chainId':
          result = '0xdee1';
          break;
        case 'eth_getBlockByNumber':
          result = {
            number: '0x64',
            hash: '0x' + '1'.repeat(64),
            baseFeePerGas: baseFee,
            gasLimit: '0x1000000',
          };
          break;
        case 'eth_getTransactionCount':
          result = nonce;
          break;
        case 'eth_getBalance':
          result = '0x10000000000000000';
          break;
        case 'eth_gasPrice':
          result = '0x64';
          break;
        case 'eth_feeHistory':
          result = { oldestBlock: '0x63', baseFeePerGas: [baseFee, baseFee] };
          break;
        case 'eth_maxPriorityFeePerGas':
          result = '0x0';
          break;
        case 'eth_estimateGas':
          result = '0xea60';
          break;
        case 'eth_sendRawTransaction':
          broadcasts++;
          throw Error('unexpected broadcast');
        default:
          throw Error('unexpected method');
      }
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
        { headers: { 'content-type': 'application/json' } }
      );
    },
  });
  const controller = new NativeTransfers(source, () => runtime as any, { rpc });
  return {
    controller,
    rpc,
    setBaseFee(value: unknown) {
      baseFee = value;
    },
    setNonce(value: unknown) {
      nonce = value;
    },
    counters: () => ({ signatures, writes, broadcasts, locks }),
  };
}

for (const kind of ['base-fee', 'nonce'] as const) {
  test(`valid ${kind} change expires the unsigned review without inventing pending state`, async () => {
    const f = fixture();
    try {
      await f.controller.prepare(to, '0.001');
      const review = f.controller.getSnapshot().review!;
      if (kind === 'base-fee') f.setBaseFee('0x12c');
      else f.setNonce('0x1');
      await assert.rejects(
        f.controller.confirm(review.id, { method: 'password', password: 'public-password' }),
        { code: 'EXPIRED' }
      );
      const state = f.controller.getSnapshot();
      assert.equal(state.phase, 'idle');
      assert.equal(state.review, null);
      assert.equal(state.hash, null);
      assert.match(state.message!, /Review the transfer again/);
      assert.doesNotMatch(
        state.message!,
        /pending|preserved|saved transaction/i
      );
      assert.deepEqual(f.counters(), {
        signatures: 0,
        writes: 0,
        broadcasts: 0,
        locks: 0,
      });
      f.setBaseFee('0x64');
      f.setNonce('0x0');
      await f.controller.prepare(to, '0.001');
      assert.notEqual(f.controller.getSnapshot().review!.id, review.id);
    } finally {
      f.controller.dispose();
    }
  });
}

for (const kind of ['base-fee', 'nonce'] as const) {
  test(`malformed ${kind} remains a failed read without inventing pending state`, async () => {
    const f = fixture();
    try {
      await f.controller.prepare(to, '0.001');
      const review = f.controller.getSnapshot().review!;
      if (kind === 'base-fee') f.setBaseFee('0xnot-a-quantity');
      else f.setNonce('0xnot-a-quantity');
      await assert.rejects(
        f.controller.confirm(review.id, { method: 'password', password: 'public-password' }),
        { code: 'FAILED' }
      );
      const state = f.controller.getSnapshot();
      assert.equal(state.phase, 'unavailable');
      assert.equal(state.hash, null);
      assert.match(state.message!, /check Activity for an existing transaction/);
      assert.doesNotMatch(state.message!, /pending|preserved/);
      await assert.rejects(f.rpc.prepare(from, to, '1', new AbortController().signal, undefined, emptyNoncePlanner), { code: 'INVALID_RESPONSE' });
      assert.deepEqual(f.counters(), {
        signatures: 0,
        writes: 0,
        broadcasts: 0,
        locks: 0,
      });
    } finally {
      f.controller.dispose();
    }
  });
}
