import type { SmartAccountPackedUserOperation } from './account';
import { getPaliEntryPointAddress, paliEntryPointInterface } from './contracts';
import {
  createSmartAccountPendingState,
  SMART_ACCOUNT_PENDING_STATE,
} from './pendingState';
import type { RetainedSmartAccountOperation } from '../../wallet/smartAccountActivity';

const account = `0x${'11'.repeat(20)}`;
const payer = `0x${'22'.repeat(20)}`;
const profileId = `0x${'33'.repeat(32)}`;
const hash = `0x${'44'.repeat(32)}`;
function fixture() {
  let nonce = BigInt(0),
    current = true;
  let retained: RetainedSmartAccountOperation[] = [];
  const reads: Array<[string, readonly any[]]> = [];
  const records = {
    profileId,
    read: jest.fn(async (fresh: boolean) => {
      void fresh;
      return retained;
    }),
  };
  const provider = {
    getFeeData: async () => ({}),
    async verifyConfiguredChainId() {
      if ((await provider.send('eth_chainId', [])) !== '0x1')
        throw new Error('wrong chain');
    },
    send: jest.fn(async (method: string, params: readonly any[]) => {
      reads.push([method, params]);
      if (method === 'eth_call')
        return paliEntryPointInterface.encodeFunctionResult('getNonce', [
          nonce,
        ]);
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_getTransactionReceipt') return null;
      if (method === 'eth_getTransactionCount') return '0x0';
      if (method === 'eth_getCode') return '0x1234';
      if (method === 'eth_estimateGas') return '0x186a0';
      if (method === 'eth_getBalance') return '0x100';
      throw new Error(method);
    }),
  };
  const state = createSmartAccountPendingState(
    provider,
    records,
    1,
    account,
    () => {
      if (!current) throw new Error('retired');
    }
  );
  return {
    state,
    reads,
    records,
    provider,
    nonce(value: bigint) {
      nonce = value;
    },
    retain(value = '0') {
      retained = [
        {
          account,
          chainId: '1',
          payer,
          hash,
          payerNonce: 0,
          operationHash: hash,
          operationNonce: value,
        },
      ];
    },
    retire() {
      current = false;
    },
  };
}
const operation = (nonce: string) =>
  ({ sender: account, nonce } as SmartAccountPackedUserOperation);

it('uses explicit pending state for code, calls, balances and both fee forms', async () => {
  const f = fixture();
  expect(await f.state.provider.getCode(account)).toBe('0x1234');
  expect((await f.state.provider.getBalance(account)).toString()).toBe('256');
  await f.state.provider.call({ to: account, data: '0x1234' });
  for (const fees of [{}, { gasPrice: '9' }]) {
    expect(
      (
        await f.state.provider.estimateGas({
          to: account,
          from: payer,
          data: '0x1234',
          ...fees,
        })
      ).toString()
    ).toBe('100000');
  }
  for (const [method, params] of f.reads) {
    if (method !== 'eth_chainId') expect(params[1]).toBe('pending');
    if (method === 'eth_estimateGas' || method === 'eth_call')
      expect(params[0]).not.toHaveProperty('nonce');
  }
  expect(f.reads.at(-1)?.[1][0].gasPrice).toBe('0x9');
  expect(f.reads.at(-2)?.[1][0]).not.toHaveProperty('gasPrice');
});

it('never advances a nonce beyond the pending RPC view to bypass a retained operation', async () => {
  const f = fixture();
  f.retain();
  await expect(f.state.readNonce(BigInt(0))).rejects.toThrow(
    SMART_ACCOUNT_PENDING_STATE
  );
  f.nonce(BigInt(1));
  await expect(f.state.readNonce(BigInt(0))).resolves.toBe('1');
  f.nonce(BigInt(3) << BigInt(64));
  await expect(f.state.readNonce(BigInt(3))).resolves.toBe(
    (BigInt(3) << BigInt(64)).toString()
  );
  await expect(f.state.readNonce(BigInt(2))).rejects.toThrow(
    'nonce key response'
  );
});

it('serializes different payers on the same profile and Smart account and rechecks the second', async () => {
  const f = fixture();
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = f.state.submit(operation('0'), async () => {
    started();
    await held;
    f.retain();
    return 'first';
  });
  await entered;
  const secondAction = jest.fn(async () => 'second');
  const second = f.state.submit(operation('0'), secondAction);
  release();
  await expect(first).resolves.toBe('first');
  await expect(second).rejects.toThrow(SMART_ACCOUNT_PENDING_STATE);
  expect(secondAction).not.toHaveBeenCalled();
  expect(f.records.read).toHaveBeenCalledWith(true);
});

it('retires a queued owner before the first payer has finished', async () => {
  const first = fixture(),
    second = fixture();
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const active = first.state.submit(operation('0'), async () => {
    started();
    await held;
  });
  await entered;
  const action = jest.fn();
  const queued = second.state.submit(operation('0'), action);
  second.retire();
  await expect(queued).rejects.toThrow('retired');
  expect(action).not.toHaveBeenCalled();
  release();
  await active;
});

it('releases a retained nonce only after exact canonical reverted inclusion', async () => {
  const f = fixture();
  f.retain();
  const send = f.provider.send.getMockImplementation()!;
  const blockHash = `0x${'55'.repeat(32)}`;
  let indexed = true,
    reorg = false;
  f.provider.send.mockImplementation(async (method, params) => {
    if (method === 'eth_getTransactionReceipt')
      return {
        transactionHash: hash,
        from: payer,
        to: getPaliEntryPointAddress(1),
        status: '0x0',
        blockNumber: '0x10',
        blockHash,
        ...(indexed ? { transactionIndex: '0x0' } : {}),
      } as never;
    if (method === 'eth_getBlockByNumber')
      return {
        number: '0x10',
        hash: reorg ? hash : blockHash,
        gasLimit: '0x100000',
        transactions: [hash],
      } as never;
    return send(method, params);
  });
  await expect(f.state.readNonce(BigInt(0))).resolves.toBe('0');
  indexed = false;
  await expect(f.state.readNonce(BigInt(0))).rejects.toThrow(
    SMART_ACCOUNT_PENDING_STATE
  );
  indexed = true;
  reorg = true;
  await expect(f.state.readNonce(BigInt(0))).rejects.toThrow('CONTEXT_CHANGED');
});

it('requires a live chain verifier before reading or signing', async () => {
  const f = fixture();
  f.provider.send.mockImplementation(async () => '0x2');
  await expect(f.state.assertNonce(operation('0'))).rejects.toThrow(
    'wrong chain'
  );
  expect(f.records.read).not.toHaveBeenCalled();
});
