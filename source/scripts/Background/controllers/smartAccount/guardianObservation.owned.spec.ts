/** @jest-environment node */
jest.unmock('crypto');
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('../..', () => ({
  getController: jest.fn(),
  notificationManager: {},
}));
jest.mock('../providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, subscribe: () => () => undefined },
}));
import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring/cjs/providers';

import MainController from '../MainController';
import {
  paliGuardianRecoveryModuleInterface as recovery,
  paliSmartAccountInterface,
} from 'utils/smartAccount/contracts';
import { PALI_INFRASTRUCTURE_BY_ID } from 'utils/smartAccount/deployment';

import SmartAccountController from './index';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const GUARDIAN = `0x${'22'.repeat(20)}`;
const OP = `0x${'33'.repeat(32)}`;
const BLOCK = {
  number: '0x64',
  hash: `0x${'aa'.repeat(32)}`,
  timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
};
const MODULE = PALI_INFRASTRUCTURE_BY_ID.guardianRecoveryModule;
let mockState: any;
function fixture() {
  const previous = global.fetch;
  const batches: any[][] = [];
  let release!: () => void;
  let reached!: () => void;
  const atPolicy = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holdPolicy = false;
  let rejectBatch = false;
  let policySignal: AbortSignal | undefined;
  global.fetch = jest.fn(async (_url, init: any) => {
    const payload = JSON.parse(init.body);
    const requests = Array.isArray(payload) ? payload : [payload];
    batches.push(requests);
    if (requests.some((row: any) => row.method === 'eth_call') && holdPolicy) {
      policySignal = init.signal;
      reached();
      await held;
      if (rejectBatch)
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Batch requests unsupported' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
    }
    const rows = requests.map((row: any) => {
      let result: any;
      if (row.method === 'eth_chainId') result = '0xdee1';
      else if (row.method === 'eth_getBlockByNumber') result = BLOCK;
      else if (row.method === 'eth_getCode')
        result = `0x${MODULE.deployCalldata!.slice(-5662 * 2)}`;
      else if (row.method === 'eth_getStorageAt')
        result = row.params[1] === '0x0' ? OP : `0x${'00'.repeat(32)}`;
      else if (row.method === 'eth_call') {
        const data = row.params[0].data;
        if (
          data.startsWith(
            paliSmartAccountInterface.getFunction('isModuleInstalled').selector
          )
        )
          result = paliSmartAccountInterface.encodeFunctionResult(
            'isModuleInstalled',
            [true]
          );
        else {
          const name = recovery.parseTransaction({ data })!.name;
          const values: Record<string, unknown[]> = {
            config: [[600, 1200, 1, true]],
            guardians: [[GUARDIAN]],
            policyEpoch: [7],
          };
          result = recovery.encodeFunctionResult(name, values[name]);
        }
      } else throw new Error(`Unexpected ${row.method}`);
      return { jsonrpc: '2.0', id: row.id, result };
    });
    return new Response(
      JSON.stringify(Array.isArray(payload) ? rows : rows[0]),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as any;
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeAccount: { id: 1, type: 'SmartAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 57057,
        url: 'https://fixture.invalid',
      },
      accounts: {
        SmartAccount: {
          1: {
            address: ACCOUNT,
            isSmartAccount: true,
            smartAccount: { chainId: 57057 },
          },
        },
      },
    },
    vaultGlobal: {
      activeSlip44: 60,
      networks: {
        ethereum: {
          57057: {
            kind: 'ethereum',
            chainId: 57057,
            url: 'https://fixture.invalid',
          },
        },
      },
    },
  };
  const provider = new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://fixture.invalid',
    57057
  );
  const wallet: any = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 1;
  wallet.walletStateGeneration = 1;
  const transaction = { web3Provider: provider };
  const controller = new SmartAccountController({
    getEthereumTransaction: () => transaction,
    getWalletSessionGeneration: () => wallet.walletSessionGeneration,
    getWalletStateGeneration: () => wallet.walletStateGeneration,
    captureReadLifetime: (check) =>
      wallet.captureSmartOwnerLifetime(check, null, Date.now() + 12000),
  } as any);
  wallet.smartAccount = controller;
  let notification: Promise<unknown> | undefined;
  wallet.activityNotificationScope = () => ({ accountAddress: ACCOUNT });
  wallet.activityNotificationObserver = () => ({
    guardian: ({ read }: any) => (notification = read(OP)),
  });
  return {
    wallet,
    provider,
    batches,
    atPolicy,
    read: (signal?: AbortSignal, operation = OP) =>
      controller.getSmartAccountGuardianRecoveryStatus(
        { account: ACCOUNT, knownOperationId: operation },
        signal
      ),
    notifications: () => {
      wallet.scheduleGuardianActivityNotifications(
        mockState.vault.activeNetwork
      );
      return notification!;
    },
    hold: (unsupported = false) => {
      holdPolicy = true;
      rejectBatch = unsupported;
    },
    release: () => release(),
    policySignal: () => policySignal,
    close: () => {
      release();
      provider.destroy();
      global.fetch = previous;
    },
  };
}

test('actual screen and notification callers share one owned observation and refresh after completion', async () => {
  const f = fixture();
  f.hold();
  try {
    const screen = f.wallet.getSmartAccountGuardianRecoveryStatus({
      account: ACCOUNT,
      knownOperationId: OP,
    });
    await f.atPolicy;
    const notification = f.notifications();
    f.release();
    const [left, right] = await Promise.all([screen, notification]);
    expect(left).toEqual(right);
    expect(left).not.toBe(right);
    expect(f.batches.map((rows) => rows.length)).toEqual([2, 6, 1, 2]);
    expect(f.batches.flat()).toHaveLength(11);
    await f.read();
    expect(f.batches.flat()).toHaveLength(22);
  } finally {
    f.close();
  }
});

test('one subscriber can cancel while the other finishes, and last cancellation aborts transport', async () => {
  const f = fixture();
  f.hold();
  const first = new AbortController();
  const second = new AbortController();
  try {
    const one = f.read(first.signal);
    const rejected = expect(one).rejects.toThrow('screen closed');
    await f.atPolicy;
    const two = f.read(second.signal);
    first.abort(new Error('screen closed'));
    await rejected;
    expect(f.policySignal()?.aborted).toBe(false);
    f.release();
    await two;
    expect(f.batches.flat()).toHaveLength(11);
  } finally {
    f.close();
  }
  const last = fixture();
  last.hold();
  const cancel = new AbortController();
  try {
    const result = last.read(cancel.signal);
    const rejected = expect(result).rejects.toThrow('closed');
    await last.atPolicy;
    cancel.abort(new Error('closed'));
    await rejected;
    expect(last.policySignal()?.aborted).toBe(true);
    last.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(last.batches).toHaveLength(2);
  } finally {
    last.close();
  }
});

test('actual session retirement aborts a held policy batch before unsupported-batch scalar fallback', async () => {
  const f = fixture();
  f.hold(true);
  try {
    const read = f.read();
    const rejected = expect(read).rejects.toThrow();
    await f.atPolicy;
    f.wallet.advanceWalletSession();
    await rejected;
    expect(f.policySignal()?.aborted).toBe(true);
    f.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(f.batches.map((rows) => rows.length)).toEqual([2, 6]);
    expect(f.provider.signal.aborted).toBe(false);
  } finally {
    f.close();
  }
});
