import { defaultAbiCoder, keccak256 } from 'utils/ethersV6Compat';

import {
  paliGuardianRecoveryModuleInterface as moduleInterface,
  paliSmartAccountInterface,
} from './contracts';
import { PALI_INFRASTRUCTURE_BY_ID } from './deployment';
import {
  getGuardianRecoveryOperationId,
  readGuardianRecoveryObservation,
} from './guardianStatus';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const GUARDIAN = `0x${'22'.repeat(20)}`;
const MODULE = PALI_INFRASTRUCTURE_BY_ID.guardianRecoveryModule.address;
const CODE = `0x${PALI_INFRASTRUCTURE_BY_ID.guardianRecoveryModule.deployCalldata!.slice(
  -5662 * 2
)}`;
const ZERO = `0x${'00'.repeat(32)}`;
const OP = `0x${'33'.repeat(32)}`;
const OLD = `0x${'44'.repeat(32)}`;
const TIME = 1800000000;
const word = (value: bigint | number) =>
  `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const slot = (type: string, key: string, index: number) =>
  keccak256(defaultAbiCoder.encode([type, 'uint256'], [key, index]));

function fixture() {
  const state = {
    block: {
      number: '0x64',
      hash: `0x${'aa'.repeat(32)}`,
      timestamp: `0x${TIME.toString(16)}`,
    },
    active: OP,
    installed: true,
    code: CODE,
    chain: '0xdee1',
    epoch: 7,
    schedule: new Map([[OP, word(TIME - 100)]]),
  };
  const send = jest.fn(async (method: string, params: any[]) => {
    switch (method) {
      case 'eth_chainId':
        return state.chain;
      case 'eth_getBlockByNumber':
        return { ...state.block };
      case 'eth_getCode':
        return state.code;
      case 'eth_getStorageAt': {
        if (params[1] === slot('address', ACCOUNT, 3)) return state.active;
        for (const [id, value] of state.schedule)
          if (params[1] === slot('bytes32', id, 4)) return value;
        return ZERO;
      }
      case 'eth_call': {
        const { data } = params[0];
        if (
          data.startsWith(
            paliSmartAccountInterface.getFunction('isModuleInstalled').selector
          )
        )
          return paliSmartAccountInterface.encodeFunctionResult(
            'isModuleInstalled',
            [state.installed]
          );
        const parsed = moduleInterface.parseTransaction({ data })!;
        if (parsed.name === 'config')
          return moduleInterface.encodeFunctionResult('config', [
            [600, 604800, 1, state.installed],
          ]);
        if (parsed.name === 'guardians')
          return moduleInterface.encodeFunctionResult('guardians', [
            [GUARDIAN],
          ]);
        if (parsed.name === 'policyEpoch')
          return moduleInterface.encodeFunctionResult('policyEpoch', [
            state.epoch,
          ]);
      }
    }
    throw new Error(`Unexpected request ${method}`);
  });
  const read = (extra = {}) =>
    readGuardianRecoveryObservation({
      provider: { send },
      account: ACCOUNT,
      moduleAddress: MODULE,
      chainId: 57057,
      now: () => TIME * 1000,
      ...extra,
    });
  return { state, send, read };
}

test('pins the actual compiled canonical runtime before interpreting storage', () => {
  const contract = PALI_INFRASTRUCTURE_BY_ID.guardianRecoveryModule;
  expect(keccak256(CODE)).toBe(contract.runtimeCodeHash);
  expect(contract.runtimeCodeHash).not.toBe(contract.bytecodeHash);
});

test('discovers an external recovery without a local intent at one block', async () => {
  const f = fixture();
  const result = await f.read();
  expect(result.pending).toEqual({
    operationId: OP,
    scheduledAt: TIME - 100,
    executableAt: TIME + 500,
    expiresAt: TIME + 605300,
    status: 'pending',
  });
  expect(result.knownOperation).toBeNull();
  expect(result.policyEpoch).toBe('7');
  const storage = f.send.mock.calls.filter(
    ([method]) => method === 'eth_getStorageAt'
  );
  expect(storage).toHaveLength(2);
  for (const [method, params] of f.send.mock.calls) {
    if (['eth_getCode', 'eth_call'].includes(method))
      expect(params[1]).toBe('0x64');
    if (method === 'eth_getStorageAt') expect(params[2]).toBe('0x64');
  }
});

test.each([
  ['ready', TIME - 600],
  ['expired', TIME - 605400],
] as const)(
  'classifies %s using chain time, not local readyAt',
  async (status, scheduledAt) => {
    const f = fixture();
    f.state.schedule.set(OP, word(scheduledAt));
    const result = await f.read();
    expect(result.active?.status).toBe(status);
    expect(result.pending === null).toBe(status === 'expired');
  }
);

test.each([
  ['executed', 48],
  ['canceled', 56],
] as const)(
  'reports known local %s without erasing anything or needing logs',
  async (status, shift) => {
    const f = fixture();
    f.state.schedule.set(
      OLD,
      word(BigInt(TIME - 300) | (BigInt(1) << BigInt(shift)))
    );
    const result = await f.read({ knownOperationId: OLD });
    expect(result.pending?.operationId).toBe(OP);
    expect(result.knownOperation?.status).toBe(status);
    expect(
      f.send.mock.calls.filter(([method]) => method === 'eth_getStorageAt')
    ).toHaveLength(3);
    expect(
      f.send.mock.calls.some(([method]) =>
        /sendRaw|sendTransaction|getLogs/.test(method)
      )
    ).toBe(false);
  }
);

test('a missing known local schedule remains unknown, not proof that it was never broadcast', async () => {
  const f = fixture();
  f.state.active = ZERO;
  const result = await f.read({ knownOperationId: OLD });
  expect(result.pending).toBeNull();
  expect(result.knownOperation?.status).toBe('unknown');
});

test('a rejected metadata read does not abandon another still-pending raw request', async () => {
  const f = fixture();
  const original = f.send.getMockImplementation()!;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.send.mockImplementation(async (method, params) => {
    if (method === 'eth_call') {
      const fn = params[0].data.slice(0, 10);
      if (fn === moduleInterface.getFunction('config').selector)
        throw new Error('config failed');
      if (fn === moduleInterface.getFunction('guardians').selector) await held;
    }
    return original(method, params);
  });
  let settled = false;
  const result = f.read().catch((error) => {
    settled = true;
    throw error;
  });
  const rejected = expect(result).rejects.toThrow('config failed');
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await rejected;
});

test('deduplicates a matching local ID and uses the persisted policy epoch', async () => {
  const operation = {
    account: ACCOUNT,
    policyEpoch: '6',
    salt: OP,
    mode: ZERO,
    executionCalldata: '0x1234',
  };
  expect(getGuardianRecoveryOperationId(operation)).toBe(
    keccak256(
      defaultAbiCoder.encode(
        ['address', 'uint256', 'bytes32', 'bytes32', 'bytes'],
        [ACCOUNT, 6, OP, ZERO, '0x1234']
      )
    )
  );
  const f = fixture();
  await f.read({ knownOperationId: OP });
  expect(
    f.send.mock.calls.filter(([method]) => method === 'eth_getStorageAt')
  ).toHaveLength(2);
});

test.each([
  'runtime',
  'chain',
  'stale',
  'layout',
  'missing schedule',
  'reorg',
  'RPC',
  'context',
])('fails closed for %s', async (kind) => {
  const f = fixture();
  if (kind === 'runtime') f.state.code = '0x6000';
  if (kind === 'chain') f.state.chain = '0x1';
  if (kind === 'stale')
    f.state.block.timestamp = `0x${(TIME - 421).toString(16)}`;
  if (kind === 'layout')
    f.state.schedule.set(OP, word(BigInt(1) << BigInt(64)));
  if (kind === 'missing schedule') f.state.schedule.clear();
  const original = f.send.getMockImplementation()!;
  if (kind === 'reorg')
    f.send.mockImplementation(async (method, params) =>
      method === 'eth_getBlockByNumber' && params[0] === '0x64'
        ? { ...f.state.block, hash: OP }
        : original(method, params)
    );
  if (kind === 'RPC') f.send.mockRejectedValue(new Error('offline'));
  const assertCurrent =
    kind === 'context'
      ? () => {
          if (f.send.mock.calls.length > 3) throw new Error('context changed');
        }
      : () => undefined;
  await expect(f.read({ assertCurrent })).rejects.toThrow();
});

test.each(['future schedule', 'both flags', 'zero epoch', 'completion stale'])(
  'rejects impossible or expired snapshot: %s',
  async (kind) => {
    const f = fixture();
    if (kind === 'future schedule') f.state.schedule.set(OP, word(TIME + 1));
    if (kind === 'both flags')
      f.state.schedule.set(
        OP,
        word(
          BigInt(TIME - 100) |
            (BigInt(1) << BigInt(48)) |
            (BigInt(1) << BigInt(56))
        )
      );
    if (kind === 'zero epoch') f.state.epoch = 0;
    let calls = 0;
    await expect(
      f.read({
        now: () =>
          (TIME + (kind === 'completion stale' && calls++ ? 421 : 0)) * 1000,
      })
    ).rejects.toThrow();
  }
);
