import { prepareEvmDappQuote } from '../../shared/evmDappPreparation';
import { NATIVE_EVM_FEE_FUNDING } from '../../shared/evmFeeApproval';
import { readFreshEvmState } from '../../shared/evmReadPhase';

import {
  ERC7579_MODE_SINGLE_DEFAULT,
  buildSmartAccountUserOperation,
  encodeERC7579Executions,
  encodeSmartAccountGasFees,
  type SmartAccountPackedUserOperation,
} from './account';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from './contracts';
import { SmartAccountPayerPendingError } from './executionSimulationError';
import {
  createSmartAccountPendingState,
  SMART_ACCOUNT_PENDING_STATE,
} from './pendingState';
import type { EvmSignedRecordSummary } from '../../wallet/evmSignedRecords';
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
  ({
    sender: account,
    nonce,
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [
      ERC7579_MODE_SINGLE_DEFAULT,
      payer + '0'.repeat(64),
    ]),
  } as SmartAccountPackedUserOperation);

it.each([false, true])(
  'verifies canonicality after retained-revert reconciliation, reorg=%s',
  async (reorg) => {
    const f = fixture();
    f.retain();
    const original = f.provider.send.getMockImplementation()!;
    const canonicalHash = `0x${'55'.repeat(32)}`;
    let estimated = false;
    let numberedReads = 0;
    f.provider.send.mockImplementation(async (method, params) => {
      if (method === 'eth_getTransactionReceipt')
        return {
          transactionHash: hash,
          from: payer,
          to: getPaliEntryPointAddress(1),
          status: '0x0',
          blockNumber: '0x10',
          blockHash: canonicalHash,
          transactionIndex: '0x0',
        } as never;
      if (method === 'eth_getBlockByNumber') {
        if (params[0] === '0x10') numberedReads++;
        return {
          number: '0x10',
          gasLimit: '0x100000',
          transactions: [hash],
          hash: reorg && estimated ? hash : canonicalHash,
        } as never;
      }
      if (method === 'eth_estimateGas') estimated = true;
      return original(method, params);
    });
    const quoted = f.state.withReadPhase(async (state) => {
      await state.assertNonce(operation('0'));
      return prepareEvmDappQuote(
        { from: payer, to: account, value: '0', data: '0x', gasPrice: '1' },
        {
          chainId: '1',
          scope: 'reconciled payer',
          feePolicy: 'fixed',
          funding: NATIVE_EVM_FEE_FUNDING,
          gasPolicy: { kind: 'estimate' },
          assertCurrent: () => undefined,
          now: () => 1,
          read: (method, params) => state.provider.send(method, params),
          verifyChain: () => state.provider.verifyConfiguredChainId(true),
          verifyBlock: async (block) => {
            const current = await readFreshEvmState(
              state.provider,
              'eth_getBlockByNumber',
              ['0x10', false]
            );
            if (current.hash !== block.hash)
              throw new Error('Canonical block changed');
          },
          nonce: async () => ({ nonce: BigInt(0), state: 'pending' }),
          balance: async () => BigInt(1_000_000),
          fees: async () => {
            throw new Error('Fixed fees do not need recommendations');
          },
        }
      );
    });
    if (reorg) await expect(quoted).rejects.toThrow('Canonical block changed');
    else
      await expect(quoted).resolves.toMatchObject({
        transaction: { nonce: '0' },
      });
    expect(numberedReads).toBe(2);
  }
);

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

it('excludes only the exact current signed row during fresh submission checks', async () => {
  const f = fixture();
  f.retain();
  const current = f.state.onProvider(f.provider, hash.toUpperCase());
  await expect(current.assertNonce(operation('0'))).resolves.toBeUndefined();
  expect(f.records.read).toHaveBeenCalledWith(true);
  expect(f.provider.send).not.toHaveBeenCalledWith(
    'eth_getTransactionReceipt',
    expect.anything()
  );
  await expect(f.state.assertNonce(operation('0'))).rejects.toThrow(
    SMART_ACCOUNT_PENDING_STATE
  );
});

it('still blocks a competing signed row with the same smart-account nonce', async () => {
  const f = fixture();
  f.retain();
  const retained = await f.records.read(true);
  const competitor = {
    ...retained[0],
    hash: `0x${'55'.repeat(32)}`,
    payerNonce: 1,
  };
  f.records.read.mockResolvedValue([...retained, competitor]);
  const current = f.state.onProvider(f.provider, hash);
  await expect(current.assertNonce(operation('0'))).rejects.toThrow(
    SMART_ACCOUNT_PENDING_STATE
  );
  expect(f.provider.send).toHaveBeenCalledWith('eth_getTransactionReceipt', [
    competitor.hash,
  ]);
  expect(f.provider.send).not.toHaveBeenCalledWith(
    'eth_getTransactionReceipt',
    [hash]
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
  const first = f.state.submit(operation('0'), async (admit) => {
    await admit();
    started();
    await held;
    f.retain();
    return 'first';
  });
  await entered;
  const secondAction = jest.fn(async () => 'second');
  const second = f.state.submit(operation('0'), async (admit) => {
    await admit();
    return secondAction();
  });
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
  const active = first.state.submit(operation('0'), async (admit) => {
    await admit();
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

function payerFixture(latest: bigint, pending: bigint) {
  const f = fixture();
  let current = true;
  const readPayerRecords = jest.fn(
    async (): Promise<readonly EvmSignedRecordSummary[]> => []
  );
  const records = { ...f.records, readPayerRecords };
  const state = createSmartAccountPendingState(
    f.provider,
    records,
    1,
    account,
    () => {
      // Exercise the same owning context as the existing fixture.
      if (!current) throw new Error('retired');
    }
  );
  let canonical = latest;
  const send = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, params) => {
    if (method === 'eth_getTransactionCount') {
      expect(params[0]).toBe(payer);
      return `0x${(params[1] === 'pending' ? pending : canonical).toString(
        16
      )}`;
    }
    return send(method, params);
  });
  return {
    ...f,
    state,
    readPayerRecords,
    canonical(value: bigint) {
      canonical = value;
    },
    retire() {
      current = false;
    },
  };
}

const payerRecord = (
  nonce: number,
  changes: Partial<EvmSignedRecordSummary> = {}
): EvmSignedRecordSummary => ({
  chainId: '1',
  from: payer,
  nonce,
  hash,
  phase: 'submitted',
  createdAt: 1,
  operation: 'send',
  signer: { id: 0, type: 'HDAccount' },
  ...changes,
});

it('avoids journal reads when the payer has no external pending gap', async () => {
  const f = payerFixture(BigInt(3), BigInt(3));
  await expect(f.state.assertPayerPredecessors(payer)).resolves.toBeUndefined();
  expect(f.readPayerRecords).not.toHaveBeenCalled();
});

it('blocks a missing payer predecessor and resolves after it confirms', async () => {
  const f = payerFixture(BigInt(3), BigInt(4));
  await expect(f.state.assertPayerPredecessors(payer)).rejects.toBeInstanceOf(
    SmartAccountPayerPendingError
  );
  f.canonical(BigInt(4));
  await expect(f.state.assertPayerPredecessors(payer)).resolves.toBeUndefined();
  expect(f.readPayerRecords).toHaveBeenCalledTimes(1);
});

it('allows contiguous local payer records across native and Smart transactions', async () => {
  const f = payerFixture(BigInt(3), BigInt(5));
  f.readPayerRecords.mockResolvedValue([
    payerRecord(3),
    payerRecord(4, { phase: 'signed' }),
  ]);
  await expect(f.state.assertPayerPredecessors(payer)).resolves.toBeUndefined();
  expect(f.readPayerRecords).toHaveBeenCalledWith(payer);
});

it.each([
  { chainId: '2' },
  { from: account },
  { phase: 'confirmed' as const },
  { nonce: 4 },
])(
  'does not fill a payer nonce gap with mismatched local records %j',
  async (changes) => {
    const f = payerFixture(BigInt(3), BigInt(4));
    f.readPayerRecords.mockResolvedValue([payerRecord(3, changes)]);
    await expect(f.state.assertPayerPredecessors(payer)).rejects.toBeInstanceOf(
      SmartAccountPayerPendingError
    );
  }
);

it('rechecks confirmation after a missing predecessor is discovered', async () => {
  const f = payerFixture(BigInt(3), BigInt(4));
  f.readPayerRecords.mockImplementation(async () => {
    f.canonical(BigInt(4));
    return [];
  });
  await expect(f.state.assertPayerPredecessors(payer)).resolves.toBeUndefined();
  expect(
    f.provider.send.mock.calls.filter(
      ([method]) => method === 'eth_getTransactionCount'
    )
  ).toHaveLength(3);
});

it('retires the early payer check after its context changes during journal access', async () => {
  const f = payerFixture(BigInt(3), BigInt(4));
  f.readPayerRecords.mockImplementation(async () => {
    f.retire();
    return [];
  });
  await expect(f.state.assertPayerPredecessors(payer)).rejects.toThrow(
    'retired'
  );
});

it('bounds a large payer gap even when every nonce has a local record', async () => {
  const f = payerFixture(BigInt(0), BigInt(17));
  f.readPayerRecords.mockResolvedValue(
    Array.from({ length: 17 }, (_, nonce) => payerRecord(nonce))
  );
  await expect(f.state.assertPayerPredecessors(payer)).rejects.toBeInstanceOf(
    SmartAccountPayerPendingError
  );
});

it('uses one canonical nonce observation per fresh phase when retained authorizations require it', async () => {
  const f = fixture();
  let canonical = BigInt(1);
  let retainedNonce = '0';
  const readAuthorizations = jest.fn(async () => [
    {
      account,
      chainId: '1',
      operationHash: hash,
      operationNonce: retainedNonce,
    },
  ]);
  const original = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, params) =>
    method === 'eth_call'
      ? paliEntryPointInterface.encodeFunctionResult('getNonce', [
          params.at(-1) === 'pending' ? canonical + BigInt(1) : canonical,
        ])
      : original(method, params)
  );
  const state = createSmartAccountPendingState(
    f.provider,
    { ...f.records, readAuthorizations },
    1,
    account,
    () => undefined
  );
  const observe = () =>
    state.withReadPhase(async (phase) => {
      const values = await Promise.all([
        phase.readNonce(BigInt(0)),
        phase.readNonce(BigInt(0)),
      ]);
      expect(values).toEqual([canonical.toString(), canonical.toString()]);
    });
  await observe();
  canonical = BigInt(2);
  retainedNonce = '1';
  await observe();
  expect(readAuthorizations).toHaveBeenCalledTimes(2);
  expect(
    f.provider.send.mock.calls
      .filter(([method]) => method === 'eth_call')
      .map(([, params]) => params.at(-1))
  ).toEqual(['latest', 'latest']);
  retainedNonce = '2';
  await expect(observe()).rejects.toThrow(SMART_ACCOUNT_PENDING_STATE);
  expect(readAuthorizations).toHaveBeenCalledTimes(3);
});

it('does not advance a live retained authorization from a pending-only nonce increment', async () => {
  const f = fixture();
  const original = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, params) =>
    method === 'eth_call'
      ? paliEntryPointInterface.encodeFunctionResult('getNonce', [
          params.at(-1) === 'pending' ? 1 : 0,
        ])
      : original(method, params)
  );
  const state = createSmartAccountPendingState(
    f.provider,
    {
      ...f.records,
      readAuthorizations: async () => [
        { account, chainId: '1', operationHash: hash, operationNonce: '0' },
      ],
    },
    1,
    account,
    () => undefined
  );
  await expect(
    state.withReadPhase((phase) => phase.readNonce(BigInt(0)))
  ).rejects.toThrow(SMART_ACCOUNT_PENDING_STATE);
  expect(
    f.provider.send.mock.calls
      .filter(([method]) => method === 'eth_call')
      .map(([, params]) => params.at(-1))
  ).toEqual(['latest']);
});

it('primes each authenticated phase before batching its header, nonce and financial reads', async () => {
  const canonicalHash = '0x' + '55'.repeat(32);
  const block = {
    number: '0x10',
    hash: canonicalHash,
    gasLimit: '0x100000',
    baseFeePerGas: '0x1',
  };
  let current = BigInt(1);
  const calls: Array<Array<{ method: string; params: readonly any[] }>> = [];
  const readAuthorizations = jest.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return [
      {
        account,
        chainId: '1',
        operationHash: hash,
        operationNonce: (current - BigInt(1)).toString(),
      },
    ];
  });
  const result = (method: string, params: readonly any[]) => {
    if (method === 'eth_getBlockByNumber') return block;
    if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
    if (method === 'eth_estimateGas') return '0x5208';
    if (method === 'eth_call')
      return params[0].data.startsWith(
        paliEntryPointInterface.getFunction('getNonce')!.selector
      )
        ? paliEntryPointInterface.encodeFunctionResult('getNonce', [current])
        : paliEntryPointInterface.encodeFunctionResult('balanceOf', [
            BigInt('1000000000000000000'),
          ]);
    throw new Error('Unexpected ' + method);
  };
  const provider = {
    signal: new AbortController().signal,
    verifyConfiguredChainId: async () => undefined,
    send: async (method: string, params: readonly unknown[]) =>
      result(method, params),
    readMany: async (
      requests: Array<{ method: string; params: readonly any[] }>
    ) => {
      calls.push(requests);
      return requests.map((request) => ({
        status: 'fulfilled' as const,
        value: result(request.method, request.params),
      }));
    },
  };
  const pending = createSmartAccountPendingState(
    provider,
    { profileId, read: async () => [], readAuthorizations },
    1,
    account,
    () => undefined
  );
  const execution = encodeERC7579Executions([
    { target: payer, value: '1', data: '0x' },
  ]);
  for (let round = 0; round < 2; round++) {
    const signed = buildSmartAccountUserOperation({
      sender: account,
      nonce: current.toString(),
      callData: paliSmartAccountInterface.encodeFunctionData('execute', [
        execution.mode,
        execution.executionCalldata,
      ]),
      gasFees: encodeSmartAccountGasFees({
        maxFeePerGas: 1,
        maxPriorityFeePerGas: 1,
      }),
    });
    const start = calls.length;
    await pending.withReadPhase(async (phase) => {
      await Promise.all([
        phase.assertNonce(signed),
        prepareEvmDappQuote(
          {
            from: payer,
            to: account,
            data: '0x1234',
            value: '0',
            maxFeePerGas: '3',
            maxPriorityFeePerGas: '1',
          },
          {
            chainId: '1',
            scope: 'same-phase',
            funding: NATIVE_EVM_FEE_FUNDING,
            feePolicy: 'fixed',
            gasPolicy: { kind: 'estimate' },
            assertCurrent: () => undefined,
            now: () => 1,
            read: (method, params) => phase.provider.send(method, [...params]),
            verifyChain: async () => {
              await phase.provider.verifyConfiguredChainId(true);
            },
            verifyBlock: async () => undefined,
            nonce: async () => ({
              nonce: BigInt(0),
              state: 'pending' as const,
            }),
            balance: async () => BigInt('1000000000000000000'),
            fees: async () => {
              throw new Error('Unused fixed fee recommendations');
            },
          }
        ),
      ]);
    });
    const first = calls[start];
    expect(first).toHaveLength(4);
    expect(first.map((row) => row.method).sort()).toEqual(
      ['eth_call', 'eth_call', 'eth_getBalance', 'eth_getBlockByNumber'].sort()
    );
    current++;
  }
  expect(readAuthorizations).toHaveBeenCalledTimes(2);
});
