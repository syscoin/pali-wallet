import assert from 'node:assert/strict';
import test from 'node:test';
import { Subject } from 'rxjs';
import { ownLedgerTransport } from '../src/hardware/ownedLedgerTransport.ts';
import type { LedgerDmkHost } from '@sidhujag/sysweb3-keyring/esm/ledger/dmk-selected-host';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture() {
  const signal = new AbortController();
  const events: string[] = [];
  const devices = new Subject<any[]>();
  let current = true;
  let stop: () => Promise<void> = async () => {
    events.push('stop');
  };
  let disconnect: () => Promise<void> = async () => {
    events.push('disconnect');
  };
  let read: (...args: any[]) => Promise<any> = async (...args) => args;
  const accept = async (candidate: object) => {
    events.push('select');
    return void candidate;
  };
  const statusListeners = new Set<() => void>();
  const sharedHost: LedgerDmkHost = {
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    connect: async () => {
      events.push('connect');
    },
    disconnect: () => disconnect(),
    getStatus: () => ({ connected: true }),
    beginDeviceSelection: () => accept,
    evm: {
      getAddress: (...args) => read(...args),
      signTransaction: (...args) => read(...args),
      signPersonalMessage: (...args) => read(...args),
      signTypedData: (...args) => read(...args),
    },
    utxo: {
      getXpub: (...args) => read(...args),
      getAddress: (...args) => read(...args),
      getAccount: (...args) => read(...args),
      signMessage: (...args) => read(...args),
      signPsbt: (...args) => read(...args),
    },
  };
  const transport = ownLedgerTransport(
    {
      signal: signal.signal,
      assertCurrent() {
        assert(current, 'Wallet authority changed');
      },
    },
    {
      listenToAvailableDevices: () => devices,
      stopDiscovering: () => stop(),
      close: () => {
        events.push('dmk-close');
      },
    },
    sharedHost,
    async () => {
      events.push('native-close');
    }
  );
  return {
    transport,
    events,
    signal,
    devices,
    status() {
      for (const listener of statusListeners) listener();
    },
    statusListeners: () => statusListeners.size,
    revoke: () => {
      current = false;
    },
    setRead: (fn: typeof read) => {
      read = fn;
    },
    setDisconnect: (fn: typeof disconnect) => {
      disconnect = fn;
    },
    setStop: (fn: typeof stop) => {
      stop = fn;
    },
  };
}

test('BLE discovery lists devices without selecting or connecting', async () => {
  const f = fixture(),
    lists: unknown[] = [];
  const stop = await f.transport.observeDevices(
    (rows) => lists.push(rows),
    (error) => assert.fail(String(error))
  );
  const candidate = {
    id: 'device',
    name: 'Ledger',
    transport: 'RN_BLE',
    deviceModel: {},
  };
  f.devices.next([candidate]);
  assert.deepEqual(lists, [[candidate]]);
  assert.deepEqual(f.events, []);
  await f.transport.host.beginDeviceSelection()(candidate);
  assert.deepEqual(f.events, ['select']);
  await stop();
  await f.transport.dispose();
});

test('disconnect drains before native resources are destroyed and is idempotent', async () => {
  const f = fixture(),
    wait = deferred<void>();
  f.setDisconnect(async () => {
    f.events.push('disconnect');
    await wait.promise;
  });
  const disposal = f.transport.dispose();
  assert.equal(f.transport.dispose(), disposal);
  await Promise.resolve();
  assert(!f.events.includes('native-close'));
  wait.resolve();
  await disposal;
  assert.deepEqual(f.events, ['disconnect', 'dmk-close', 'native-close']);
});

test('owner abort retires the shared host and prevents late signature delivery', async () => {
  const f = fixture(),
    wait = deferred<any>();
  f.setRead(() => wait.promise);
  const signing = f.transport.host.evm.signPersonalMessage({
    accountIndex: 0,
    expectedAddress: '0x' + '11'.repeat(20),
    messageHex: '0x1234',
  });
  f.signal.abort();
  wait.resolve('late-signature');
  await assert.rejects(signing, /cancel/i);
  await f.transport.dispose();
  assert.equal(f.transport.host.getStatus().connected, false);
  await assert.rejects(f.transport.host.connect(), /cancel/i);
  assert.throws(() => f.transport.host.beginDeviceSelection(), /cancel/i);
});

test('authority changes reject stale responses even before abort notification', async () => {
  const f = fixture(),
    wait = deferred<any>();
  f.setRead(() => wait.promise);
  const reading = f.transport.host.utxo.getXpub({
    currency: 'SYS',
    slip44: 57,
    accountIndex: 0,
  });
  f.revoke();
  wait.resolve('stale-xpub');
  await assert.rejects(reading, /authority changed/);
  await f.transport.dispose();
});

test('disposal still destroys native resources when disconnect fails', async () => {
  const f = fixture();
  f.setDisconnect(async () => {
    throw Error('disconnect failed');
  });
  await assert.rejects(f.transport.dispose(), /disconnect failed/);
  assert.deepEqual(f.events, ['dmk-close', 'native-close']);
});

test('late discovery results and errors are not published after disposal', async () => {
  const f = fixture(),
    rows: unknown[] = [],
    errors: unknown[] = [];
  await f.transport.observeDevices(
    (value) => rows.push(value),
    (error) => errors.push(error)
  );
  await f.transport.dispose();
  f.devices.next([{}]);
  f.devices.error(Error('late'));
  assert.deepEqual(rows, []);
  assert.deepEqual(errors, []);
});

test('hardware request and required PSBT authority are forwarded unchanged', async () => {
  const f = fixture();
  const request = {
    currency: 'SYS',
    slip44: 57,
    accountIndex: 0,
    accountXpub: 'public',
    psbtBase64: 'PSBT',
  };
  const authority = { assertCurrent() {}, signal: f.signal.signal };
  let forwarded: unknown[] = [];
  f.setRead(async (...args) => {
    forwarded = args;
    return { fingerprint: '00000000', signatures: [] };
  });
  await f.transport.host.utxo.signPsbt(request, authority);
  assert.equal(forwarded[0], request);
  assert.equal(forwarded[1], authority);
  await f.transport.dispose();
});

test('a new scan waits for the previous stop and old handles cannot stop it', async () => {
  const f = fixture(),
    wait = deferred<void>();
  const firstStop = await f.transport.observeDevices(
    () => undefined,
    (error) => assert.fail(String(error))
  );
  f.setStop(async () => {
    f.events.push('stop');
    await wait.promise;
  });
  const stopped = firstStop();
  let started = false;
  const next = f.transport
    .observeDevices(
      () => undefined,
      (error) => assert.fail(String(error))
    )
    .then((stop) => {
      started = true;
      return stop;
    });
  await Promise.resolve();
  assert.equal(started, false);
  wait.resolve();
  await stopped;
  const secondStop = await next;
  const count = f.events.length;
  await firstStop();
  assert.equal(f.events.length, count);
  await secondStop();
  await f.transport.dispose();
});

test('close before the scan microtask prevents discovery from starting', async () => {
  const f = fixture();
  const scanning = f.transport.observeDevices(
    () => assert.fail('stale scan'),
    (error) => assert.fail(String(error))
  );
  f.signal.abort();
  await assert.rejects(scanning, /cancel/i);
  await f.transport.dispose();
  assert.equal(f.devices.observed, false);
});

test('status forwarding ends on unsubscribe, authority retirement and transport disposal', async () => {
  const f = fixture();
  let updates = 0;
  const unsubscribe = f.transport.host.subscribeStatus(() => {
    updates++;
  });
  f.status();
  assert.equal(updates, 1);
  unsubscribe();
  f.status();
  assert.equal(updates, 1);
  f.transport.host.subscribeStatus(() => {
    updates++;
  });
  f.revoke();
  f.status();
  assert.equal(updates, 1);
  await f.transport.dispose();
  assert.equal(f.statusListeners(), 0);
  f.status();
  assert.equal(updates, 1);
});
