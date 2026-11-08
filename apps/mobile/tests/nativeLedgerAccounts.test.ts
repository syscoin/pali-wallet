import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NativeLedgerAccounts,
  type NativeLedgerRuntime,
} from '../src/custody/ledgerAccounts.ts';
import type { NativeCustodyAuthority } from '../src/custody/authority.ts';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture(purpose: 'import' | 'connect' = 'import') {
  let state = { phase: 'ready', revision: 1 };
  const catalogue = {
    revision: 2,
    active: { networkId: 'ethereum', accountId: 'ledger:60:0' },
    accounts: [{ id: 'ledger:60:0', address: '0x' + '11'.repeat(20) }],
    networks: [{ id: 'ethereum', name: 'Ethereum' }],
    utxoNetworks: [],
  };
  const listeners = new Set<(value: typeof state) => void>();
  const publish = (phase: string) => {
    state = { phase, revision: state.revision + 1 };
    for (const listener of listeners) listener(state);
  };
  let scanCount = 0;
  let closeCount = 0,
    imports = 0;
  let scanWait: Promise<void> = Promise.resolve(),
    selectWait: Promise<void> = Promise.resolve(),
    importWait: Promise<void> = Promise.resolve(),
    closeWait: Promise<void> = Promise.resolve();
  let scanError: ((error: unknown) => void) | undefined;
  let signal: AbortSignal | undefined;
  let cancelled = false,
    failSelect = false,
    connected = false;
  const authority = {
    getSnapshot: () => state,
    getCatalogue: () => catalogue,
    subscribe(listener: (value: typeof state) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancelAccountOperation() {
      cancelled = true;
    },
    async manageAccounts() {
      imports++;
      publish('authenticating');
      await importWait;
      if (cancelled) throw Error('CANCELLED');
      publish('ready');
    },
  } as unknown as NativeCustodyAuthority;
  const statusListeners = new Set<() => void>();
  const runtime: NativeLedgerRuntime = {
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    isConnected: () => connected,
    async scan(request, ownerSignal, check, onDevices, onError) {
      assert.equal(request.purpose, purpose);
      let handedOff = false;
      scanCount++;
      scanError = onError;
      signal = ownerSignal;
      await scanWait;
      if (!signal.aborted) {
        check();
        onDevices([{ id: '1:0', name: 'Ledger', model: 'Nano X' }]);
      }
      return {
        async select() {
          await selectWait;
          check();
          if (failSelect) throw Error('Device disconnected');
          return { name: 'Ledger', address: '0x' + '11'.repeat(20) };
        },
        handoff() {
          check();
          handedOff = true;
          connected = true;
        },
        async close() {
          if (!handedOff) connected = false;
          closeCount++;
          await closeWait;
        },
      };
    },
  };
  const view = new NativeLedgerAccounts(authority, () => runtime, purpose);
  return {
    view,
    publish,
    disconnect() {
      connected = false;
      for (const listener of statusListeners) listener();
    },
    statusListeners: () => statusListeners.size,
    get signal() {
      return signal;
    },
    get scanCount() {
      return scanCount;
    },
    get closeCount() {
      return closeCount;
    },
    get imports() {
      return imports;
    },
    get cancelled() {
      return cancelled;
    },
    error() {
      scanError?.(Error('scan failed'));
    },
    failSelect() {
      failSelect = true;
    },
    closeWait(value: Promise<void>) {
      closeWait = value;
    },
    scanWait(value: Promise<void>) {
      scanWait = value;
    },
    selectWait(value: Promise<void>) {
      selectWait = value;
    },
    importWait(value: Promise<void>) {
      importWait = value;
    },
  };
}

test('discovery preserves captured network and requires explicit selection', async () => {
  const f = fixture();
  await f.view.start();
  assert.equal(f.view.getSnapshot().networkLabel, 'Ethereum');
  assert.equal(f.view.getSnapshot().phase, 'scanning');
  assert.equal(f.view.getSnapshot().address, null);
  await f.view.select('1:0');
  assert.equal(f.view.getSnapshot().phase, 'connected');
  assert.match(f.view.getSnapshot().address!, /^0x/);
  await f.view.dispose();
});

test('pending discovery is retired when the view closes', async () => {
  const f = fixture(),
    wait = deferred<void>();
  f.scanWait(wait.promise);
  const start = f.view.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  let retired = false;
  const closed = f.view.close().then(() => {
    retired = true;
  });
  assert.equal(f.signal?.aborted, true);
  assert.equal(retired, false);
  wait.resolve();
  await assert.rejects(start, /CANCELLED/);
  await closed;
  assert.equal(f.closeCount, 1);
  assert.equal(f.view.getSnapshot().phase, 'idle');
  await f.view.dispose();
});

test('scope change prevents late selection publication', async () => {
  const f = fixture(),
    wait = deferred<void>();
  await f.view.start();
  f.selectWait(wait.promise);
  const selected = f.view.select('1:0');
  f.publish('locked');
  wait.resolve();
  await assert.rejects(selected, /CANCELLED/);
  assert.equal(f.view.getSnapshot().phase, 'idle');
  await f.view.dispose();
});

test('import stays mounted through managed authentication and rejects double submission', async () => {
  const f = fixture(),
    wait = deferred<void>();
  await f.view.start();
  await f.view.select('1:0');
  f.importWait(wait.promise);
  const pending = f.view.importAccount('Ledger account');
  assert.equal(f.view.getSnapshot().phase, 'importing');
  assert.equal(f.cancelled, false);
  await assert.rejects(f.view.importAccount('Duplicate'), /NOT_READY/);
  wait.resolve();
  await pending;
  assert.equal(f.imports, 1);
  assert.equal(f.view.getSnapshot().phase, 'idle');
  await f.view.dispose();
});

test('closing a pending import revokes the managed operation', async () => {
  const f = fixture(),
    wait = deferred<void>();
  await f.view.start();
  await f.view.select('1:0');
  f.importWait(wait.promise);
  const pending = f.view.importAccount('Ledger account');
  await f.view.close();
  wait.resolve();
  await assert.rejects(pending, /CANCELLED/);
  assert.equal(f.cancelled, true);
  await f.view.dispose();
});

test('all close and dispose callers join the same held native cleanup', async () => {
  const f = fixture(),
    wait = deferred<void>();
  await f.view.start();
  f.closeWait(wait.promise);
  let complete = 0;
  const first = f.view.close().then(() => {
    complete++;
  });
  const second = f.view.close().then(() => {
    complete++;
  });
  const final = f.view.dispose().then(() => {
    complete++;
  });
  await Promise.resolve();
  assert.equal(complete, 0);
  assert.equal(f.closeCount, 1);
  wait.resolve();
  await Promise.all([first, second, final]);
  assert.equal(complete, 3);
});

test('a failed scan retires its session before Find Ledger can retry', async () => {
  const f = fixture(),
    wait = deferred<void>();
  await f.view.start();
  f.closeWait(wait.promise);
  f.error();
  let restarted = false;
  const retry = f.view.start().then(() => {
    restarted = true;
  });
  await Promise.resolve();
  assert.equal(restarted, false);
  wait.resolve();
  await retry;
  assert.equal(f.view.getSnapshot().phase, 'scanning');
  await f.view.dispose();
});

test('an idle subscriber cannot restart discovery before retiring cleanup drains', async () => {
  const f = fixture(),
    wait = deferred<void>();
  await f.view.start();
  f.closeWait(wait.promise);
  let restarted: Promise<void> | undefined,
    complete = false;
  const off = f.view.subscribe(() => {
    if (f.view.getSnapshot().phase === 'idle' && !restarted) {
      restarted = f.view.start().then(() => {
        complete = true;
      });
    }
  });
  const closing = f.view.close();
  await Promise.resolve();
  assert.equal(complete, false);
  assert.equal(f.view.getSnapshot().phase, 'idle');
  wait.resolve();
  await closing;
  await restarted;
  assert.equal(f.view.getSnapshot().phase, 'scanning');
  off();
  await f.view.dispose();
});

test('a failed selection cannot overwrite a subscriber-started replacement scan', async () => {
  const f = fixture(),
    wait = deferred<void>();
  await f.view.start();
  f.closeWait(wait.promise);
  f.failSelect();
  let retry: Promise<void> | undefined;
  const off = f.view.subscribe(() => {
    if (f.view.getSnapshot().phase === 'idle' && !retry) retry = f.view.start();
  });
  const selected = f.view.select('1:0');
  void selected.catch(() => undefined);
  await new Promise<void>((resolve) => setImmediate(resolve));
  wait.resolve();
  await assert.rejects(selected, /Device disconnected/);
  await retry;
  assert.equal(f.view.getSnapshot().phase, 'scanning');
  assert.equal(f.view.getSnapshot().error, null);
  off();
  await f.view.dispose();
});

test('a disposed hardware view cannot restart or import with a still-ready authority', async () => {
  const f = fixture();
  await f.view.dispose();
  await assert.rejects(f.view.start(), /CANCELLED/);
  await assert.rejects(f.view.select('1:0'), /CANCELLED/);
  await assert.rejects(f.view.importAccount('Ledger'), /CANCELLED/);
  assert.equal(f.scanCount, 0);
});

test('terminal disposal retires a restart waiting for previous native cleanup', async () => {
  const f = fixture(),
    wait = deferred<void>();
  await f.view.start();
  f.closeWait(wait.promise);
  const close = f.view.close();
  const restarting = f.view.start();
  void restarting.catch(() => undefined);
  const disposed = f.view.dispose();
  wait.resolve();
  await close;
  await disposed;
  await assert.rejects(restarting, /CANCELLED/);
  assert.equal(f.scanCount, 1);
});

test('connection requires explicit finish and does not import an account', async () => {
  const f = fixture('connect');
  await f.view.start();
  assert.equal(f.view.getSnapshot().address, '0x' + '11'.repeat(20));
  assert.equal(f.view.isConnected(), false);
  await assert.rejects(f.view.importAccount('Unexpected'), /NOT_READY/);
  await assert.rejects(f.view.finishConnection(), /NOT_READY/);
  await f.view.select('1:0');
  assert.equal(f.view.isConnected(), false);
  await f.view.finishConnection();
  assert.equal(f.view.getSnapshot().phase, 'idle');
  assert.equal(f.view.isConnected(), true);
  assert.equal(f.imports, 0);
  await f.view.dispose();
});

test('closing an unfinished connection never transfers its device', async () => {
  const f = fixture('connect');
  await f.view.start();
  await f.view.select('1:0');
  await f.view.close();
  assert.equal(f.view.isConnected(), false);
  await assert.rejects(f.view.finishConnection(), /NOT_READY/);
  await f.view.dispose();
});

test('a scope change invalidates a selected connection before finish', async () => {
  const f = fixture('connect');
  await f.view.start();
  await f.view.select('1:0');
  f.publish('locked');
  await assert.rejects(f.view.finishConnection(), /NOT_READY/);
  assert.equal(f.view.isConnected(), false);
  await f.view.dispose();
});

test('a handed-off connection notifies subscribers immediately on disconnect', async () => {
  const f = fixture('connect');
  try {
    await f.view.start();
    await f.view.select('1:0');
    await f.view.finishConnection();
    assert.equal(f.view.isConnected(), true);
    const before = f.view.getSnapshot();
    let updates = 0;
    const unsubscribe = f.view.subscribe(() => {
      updates++;
    });
    f.disconnect();
    assert.equal(f.view.isConnected(), false);
    assert.notEqual(f.view.getSnapshot(), before);
    assert.equal(updates, 1);
    unsubscribe();
  } finally {
    await f.view.dispose();
    assert.equal(f.statusListeners(), 0);
  }
});
