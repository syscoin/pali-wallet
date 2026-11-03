import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CustodyOperationError,
  NativeCustodyAuthority,
} from '../src/custody/authority.ts';
import type {
  CustodyErrorCode,
  CustodyRuntime,
  CustodySnapshot,
  CustodyStoredState,
} from '../src/custody/types.ts';
import { CustodyRuntimeError } from '../src/custody/types.ts';

const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const PASSWORD = 'test-only password';
const PHRASE = 'test-only mnemonic input';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const rejectsCode = (promise: Promise<unknown>, code: CustodyErrorCode) =>
  assert.rejects(promise, (error: unknown) =>
    error instanceof CustodyOperationError && error.code === code && error.message === code
  );

function fixture(existing = false) {
  let stored: CustodyStoredState = {
    presence: existing ? 'existing' : 'empty', backup: 'unconfirmed',
  };
  let unlocked = false;
  const events: string[] = [];
  const runtime: CustodyRuntime = {
    session: {
      async createWallet() {
        events.push('create');
        stored = { presence: 'existing', backup: 'unconfirmed' };
        unlocked = true;
      },
      async importWallet() {
        events.push('import');
        stored = { presence: 'existing', backup: 'unconfirmed' };
        unlocked = true;
      },
      async unlock() {
        events.push('unlock');
        unlocked = true;
        return { authenticated: true };
      },
      async readEthereumAddress() {
        assert.equal(unlocked, true, 'address access requires a live session');
        events.push('address');
        return ADDRESS.toLowerCase();
      },
      async lock() {
        unlocked = false;
        events.push('lock');
      },
    },
    storage: {
      async readState() { events.push('read'); return { ...stored }; },
      async close() { events.push('close'); },
    },
  };
  const authority = new NativeCustodyAuthority({ async open() { return runtime; } });
  return {
    authority, runtime, events,
    setStored(value: CustodyStoredState) { stored = value; },
    get unlocked() { return unlocked; },
    set unlocked(value: boolean) { unlocked = value; },
  };
}

test('opening is explicit and known empty/complete stores determine onboarding', async () => {
  const fresh = fixture();
  assert.equal(fresh.authority.getSnapshot().phase, 'opening');
  await rejectsCode(fresh.authority.create(PASSWORD), 'NOT_READY');
  const opening = fresh.authority.initialize();
  assert.equal(fresh.authority.initialize(), opening);
  await opening;
  assert.equal(fresh.authority.getSnapshot().phase, 'empty');
  const existing = fixture(true);
  await existing.authority.initialize();
  assert.equal(existing.authority.getSnapshot().phase, 'locked');
  await rejectsCode(existing.authority.create(PASSWORD), 'NOT_READY');
});

test('create and import expose only a detached normalized address and never confirm backup', async () => {
  for (const operation of ['create', 'import'] as const) {
    const f = fixture();
    await f.authority.initialize();
    if (operation === 'create') await f.authority.create(PASSWORD);
    else await f.authority.importPhrase(PHRASE, PASSWORD);
    const state = f.authority.getSnapshot();
    assert.equal(state.phase, 'backup-required');
    assert.deepEqual(state.account, { network: 'ethereum', address: ADDRESS });
    assert.equal(Object.isFrozen(state), true);
    assert.equal(Object.isFrozen(state.account), true);
    assert.deepEqual(Object.keys(state).sort(), ['account', 'backup', 'error', 'phase', 'presence', 'revision']);
    f.authority.lock();
    assert.equal(f.unlocked, false);
    assert.equal(f.authority.getSnapshot().account, null);
  }
});

test('only persisted backup status of an existing wallet permits ready', async () => {
  const f = fixture(true);
  f.setStored({ presence: 'existing', backup: 'confirmed' });
  await f.authority.initialize();
  await f.authority.unlock(PASSWORD);
  assert.equal(f.authority.getSnapshot().phase, 'ready');
  assert.equal('confirmBackup' in f.authority, false);
  assert.equal('revealPhrase' in f.authority, false);
});

test('read errors, incomplete records and orphan confirmed metadata never become empty', async () => {
  for (const failure of ['throw', 'incomplete', 'orphan'] as const) {
    const f = fixture();
    f.runtime.storage.readState = async () => {
      if (failure === 'throw') throw new Error(`private ${PHRASE}`);
      return (failure === 'orphan'
        ? { presence: 'empty', backup: 'confirmed' }
        : { presence: 'incomplete', backup: 'unconfirmed' }) as unknown as CustodyStoredState;
    };
    await rejectsCode(f.authority.initialize(), 'UNAVAILABLE');
    assert.equal(f.authority.getSnapshot().phase, 'unavailable');
    assert.equal(f.authority.getSnapshot().presence, 'unknown');
    await rejectsCode(f.authority.create(PASSWORD), 'NOT_READY');
    assert.equal(JSON.stringify(f.authority.getSnapshot()).includes(PHRASE), false);
  }
});

test('credential rejection is explicit; thrown or malformed results are operational failures', async () => {
  for (const kind of ['rejected', 'throw', 'malformed'] as const) {
    const f = fixture(true);
    await f.authority.initialize();
    f.runtime.session.unlock = async () => {
      if (kind === 'throw') throw new Error(`${PASSWORD} ${PHRASE}`);
      return (kind === 'rejected'
        ? { authenticated: false }
        : { authenticated: 'false' }) as { authenticated: boolean };
    };
    const code = kind === 'rejected' ? 'INVALID_CREDENTIAL' : 'OPERATION_FAILED';
    await rejectsCode(f.authority.unlock(PASSWORD), code);
    assert.equal(f.authority.getSnapshot().error, code);
    assert.equal(f.authority.getSnapshot().account, null);
    assert.equal(f.unlocked, false);
  }
});

test('only typed runtime throttling and input errors reach the public classification', async () => {
  for (const typed of [true, false]) {
    const f = fixture(true);
    await f.authority.initialize();
    f.runtime.session.unlock = async () => {
      if (typed) throw new CustodyRuntimeError('AUTH_THROTTLED');
      throw new Error('AUTH_THROTTLED');
    };
    await rejectsCode(f.authority.unlock(PASSWORD), typed ? 'AUTH_THROTTLED' : 'OPERATION_FAILED');
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.equal(f.authority.getSnapshot().account, null);
    await f.authority.dispose();
  }
});

test('double submissions are rejected before any second SDK operation', async () => {
  const f = fixture();
  await f.authority.initialize();
  const started = deferred<void>();
  const release = deferred<void>();
  const create = f.runtime.session.createWallet;
  f.runtime.session.createWallet = async (password) => {
    started.resolve();
    await release.promise;
    await create(password);
  };
  const pending = f.authority.create(PASSWORD);
  await started.promise;
  await rejectsCode(f.authority.importPhrase(PHRASE, PASSWORD), 'BUSY');
  await rejectsCode(f.authority.create(PASSWORD), 'BUSY');
  release.resolve();
  await pending;
  assert.equal(f.events.filter((event) => event === 'create').length, 1);
});

test('lock during an SDK unlock revokes immediately and drains late completion before new authentication', async () => {
  const f = fixture(true);
  await f.authority.initialize();
  const started = deferred<void>();
  const release = deferred<void>();
  let attempts = 0;
  f.runtime.session.unlock = async () => {
    attempts++;
    if (attempts === 1) { started.resolve(); await release.promise; }
    f.unlocked = true; // SDK unlock completion can occur after lock.
    return { authenticated: true };
  };
  const pending = f.authority.unlock(PASSWORD);
  await started.promise;
  f.authority.lock();
  assert.equal(f.authority.getSnapshot().phase, 'locked');
  assert.equal(f.unlocked, false);
  await rejectsCode(f.authority.unlock(PASSWORD), 'BUSY');
  release.resolve();
  await rejectsCode(pending, 'CANCELLED');
  assert.equal(f.unlocked, false);
  assert.equal(f.events.includes('address'), false);
  await f.authority.unlock(PASSWORD);
  assert.equal(f.unlocked, true);
  assert.equal(f.authority.getSnapshot().phase, 'backup-required');
});

test('lock during creation preserves its committed wallet and prevents repeated initialization', async () => {
  const f = fixture();
  await f.authority.initialize();
  const started = deferred<void>();
  const release = deferred<void>();
  const create = f.runtime.session.createWallet;
  f.runtime.session.createWallet = async (password) => {
    started.resolve(); await release.promise; await create(password);
  };
  const pending = f.authority.create(PASSWORD);
  await started.promise;
  f.authority.lock();
  release.resolve();
  await rejectsCode(pending, 'CANCELLED');
  assert.equal(f.authority.getSnapshot().presence, 'existing');
  assert.equal(f.authority.getSnapshot().phase, 'locked');
  assert.equal(f.unlocked, false);
  await rejectsCode(f.authority.create(PASSWORD), 'NOT_READY');
  await f.authority.unlock(PASSWORD);
  assert.equal(f.authority.getSnapshot().phase, 'backup-required');
});

test('a lost creation acknowledgment reconciles durable presence without deleting or overwriting', async () => {
  const f = fixture();
  await f.authority.initialize();
  const create = f.runtime.session.createWallet;
  f.runtime.session.createWallet = async (password) => {
    await create(password);
    throw new Error('commit acknowledged after transport failed');
  };
  await rejectsCode(f.authority.create(PASSWORD), 'OPERATION_FAILED');
  assert.equal(f.authority.getSnapshot().phase, 'locked');
  assert.equal(f.authority.getSnapshot().presence, 'existing');
  await rejectsCode(f.authority.create(PASSWORD), 'NOT_READY');
  assert.equal(f.events.filter((event) => event === 'create').length, 1);
});

test('new creation rejects an unexpected confirmed backup receipt', async () => {
  const f = fixture();
  await f.authority.initialize();
  f.runtime.session.createWallet = async () => {
    f.setStored({ presence: 'existing', backup: 'confirmed' });
    f.unlocked = true;
  };
  await rejectsCode(f.authority.create(PASSWORD), 'UNAVAILABLE');
  assert.equal(f.authority.getSnapshot().phase, 'unavailable');
  assert.equal(f.unlocked, false);
});

test('storage failure after creation quarantines the authority rather than reopening onboarding', async () => {
  const f = fixture();
  await f.authority.initialize();
  f.runtime.storage.readState = async () => { throw new Error('database unavailable'); };
  await rejectsCode(f.authority.create(PASSWORD), 'UNAVAILABLE');
  assert.equal(f.authority.getSnapshot().phase, 'unavailable');
  await rejectsCode(f.authority.create(PASSWORD), 'NOT_READY');
});

test('observer exceptions and reentrant lock cannot publish stale ready data', async () => {
  const f = fixture(true);
  await f.authority.initialize();
  const later: string[] = [];
  f.authority.subscribe((state) => {
    if (state.account) f.authority.lock();
    throw new Error('broken view');
  });
  f.authority.subscribe((state) => { later.push(state.phase); });
  await rejectsCode(f.authority.unlock(PASSWORD), 'CANCELLED');
  assert.equal(later.includes('backup-required'), false);
  assert.equal(f.authority.getSnapshot().phase, 'locked');
  assert.equal(f.unlocked, false);
});

test('reentrant submission is busy and lock from authenticating prevents SDK access', async () => {
  const f = fixture();
  await f.authority.initialize();
  let nested: Promise<void> | undefined;
  f.authority.subscribe((state) => {
    if (state.phase === 'authenticating') {
      nested = rejectsCode(f.authority.create(PASSWORD), 'BUSY');
      f.authority.lock();
    }
  });
  await rejectsCode(f.authority.create(PASSWORD), 'CANCELLED');
  await nested;
  assert.equal(f.events.includes('create'), false);
});

test('lock cleanup failures quarantine the authority and never classify as wrong password', async () => {
  const f = fixture(true);
  await f.authority.initialize();
  f.runtime.session.lock = async () => { throw new Error(PASSWORD); };
  f.authority.lock();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.authority.getSnapshot().phase, 'unavailable');
  await rejectsCode(f.authority.unlock(PASSWORD), 'NOT_READY');
  await rejectsCode(f.authority.dispose(), 'CLEANUP_FAILED');
});

test('dispose waits for an in-flight durable commit then relocks and closes exactly once', async () => {
  const f = fixture();
  await f.authority.initialize();
  const started = deferred<void>();
  const release = deferred<void>();
  const create = f.runtime.session.createWallet;
  f.runtime.session.createWallet = async (password) => {
    started.resolve(); await release.promise; await create(password); f.events.push('commit');
  };
  const pending = f.authority.create(PASSWORD);
  await started.promise;
  const disposal = f.authority.dispose();
  assert.equal(f.authority.dispose(), disposal);
  assert.equal(f.authority.getSnapshot().phase, 'disposed');
  assert.equal(f.events.includes('close'), false);
  release.resolve();
  await rejectsCode(pending, 'CANCELLED');
  await disposal;
  assert.equal(f.events.at(-1), 'close');
  assert.equal(f.events.filter((event) => event === 'close').length, 1);
  assert.equal(f.unlocked, false);
});

test('dispose during runtime opening waits for the late handle and closes it without unlocking', async () => {
  const f = fixture(true);
  const release = deferred<CustodyRuntime>();
  const authority = new NativeCustodyAuthority({ open() { return release.promise; } });
  const opening = authority.initialize();
  const disposed = authority.dispose();
  release.resolve(f.runtime);
  await opening;
  await disposed;
  assert.equal(authority.getSnapshot().phase, 'disposed');
  assert.equal(f.events.includes('unlock'), false);
  assert.equal(f.events.at(-1), 'close');
});

test('disposal is reentrant, and input bounds reject before any secret-bearing port call', async () => {
  const f = fixture();
  await f.authority.initialize();
  for (const input of ['', 'x'.repeat(1025), 123]) {
    await rejectsCode(f.authority.create(input as string), 'INVALID_INPUT');
  }
  await rejectsCode(f.authority.importPhrase('x'.repeat(4097), PASSWORD), 'INVALID_INPUT');
  const states: CustodySnapshot[] = [];
  let nested: Promise<void> | undefined;
  f.authority.subscribe((state) => {
    states.push(state);
    if (state.phase === 'disposed') nested = f.authority.dispose();
  });
  const disposed = f.authority.dispose();
  assert.equal(nested, disposed);
  await disposed;
  await rejectsCode(f.authority.initialize(), 'CANCELLED');
  assert.equal(states.length, 1);
  assert.equal(f.events.includes('create'), false);
});

test('a delayed lock cleanup blocks the next authentication until the retired session is clean', async () => {
  const f = fixture(true);
  await f.authority.initialize();
  const cleanup = deferred<void>();
  const originalLock = f.runtime.session.lock;
  f.runtime.session.lock = async () => {
    await originalLock();
    await cleanup.promise;
  };
  f.authority.lock();
  const next = f.authority.unlock(PASSWORD);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.events.includes('unlock'), false);
  cleanup.resolve();
  await next;
  assert.equal(f.unlocked, true);
  assert.equal(f.authority.getSnapshot().phase, 'backup-required');
});

test('lock during public-account loading discards the late response and relocks the SDK', async () => {
  const f = fixture(true);
  await f.authority.initialize();
  const loading = deferred<void>();
  const address = deferred<string>();
  f.runtime.session.readEthereumAddress = async () => {
    loading.resolve();
    return address.promise;
  };
  const pending = f.authority.unlock(PASSWORD);
  await loading.promise;
  f.authority.lock();
  address.resolve(ADDRESS);
  await rejectsCode(pending, 'CANCELLED');
  assert.equal(f.authority.getSnapshot().account, null);
  assert.equal(f.authority.getSnapshot().phase, 'locked');
  assert.equal(f.unlocked, false);
});

test('a lock failure while authentication is pending cannot publish a ready state', async () => {
  const f = fixture(true);
  await f.authority.initialize();
  const loading = deferred<void>();
  const address = deferred<string>();
  f.runtime.session.readEthereumAddress = async () => {
    loading.resolve(); return address.promise;
  };
  const pending = f.authority.unlock(PASSWORD);
  await loading.promise;
  f.runtime.session.lock = () => { throw new Error(PASSWORD); };
  f.authority.lock();
  address.resolve(ADDRESS);
  await rejectsCode(pending, 'CANCELLED');
  assert.equal(f.authority.getSnapshot().phase, 'unavailable');
  assert.equal(f.authority.getSnapshot().account, null);
});

test('dispose from an authenticating observer drains admission without starting the SDK call', async () => {
  const f = fixture();
  await f.authority.initialize();
  let disposal: Promise<void> | undefined;
  f.authority.subscribe((state) => {
    if (state.phase === 'authenticating') disposal = f.authority.dispose();
  });
  await rejectsCode(f.authority.create(PASSWORD), 'CANCELLED');
  await disposal;
  assert.equal(f.events.includes('create'), false);
  assert.equal(f.events.at(-1), 'close');
  assert.equal(f.authority.getSnapshot().phase, 'disposed');
});

test('invalid account output and close failures expose only safe error codes', async () => {
  const f = fixture(true);
  await f.authority.initialize();
  f.runtime.session.readEthereumAddress = async () => `${PASSWORD} ${PHRASE}`;
  await rejectsCode(f.authority.unlock(PASSWORD), 'OPERATION_FAILED');
  assert.equal(f.unlocked, false);
  assert.equal(f.authority.getSnapshot().account, null);
  f.runtime.storage.close = async () => { throw new Error(PHRASE); };
  await rejectsCode(f.authority.dispose(), 'CLEANUP_FAILED');
  assert.equal(f.authority.getSnapshot().phase, 'disposed');
  assert.equal(JSON.stringify(f.authority.getSnapshot()).includes(PHRASE), false);
});

test('a known existing wallet cannot become onboarding after a successful unlock loses its store', async () => {
  const f = fixture(true);
  f.setStored({ presence: 'existing', backup: 'confirmed' });
  await f.authority.initialize();
  f.runtime.session.unlock = async () => {
    f.setStored({ presence: 'empty', backup: 'unconfirmed' });
    f.unlocked = true;
    return { authenticated: true };
  };
  await rejectsCode(f.authority.unlock(PASSWORD), 'UNAVAILABLE');
  assert.equal(f.authority.getSnapshot().phase, 'unavailable');
  assert.equal(f.authority.getSnapshot().presence, 'existing');
  await rejectsCode(f.authority.create(PASSWORD), 'NOT_READY');
  assert.equal(f.events.includes('create'), false);
  assert.equal(f.unlocked, false);
});

test('successful creation without durable records quarantines instead of permitting another creation', async () => {
  const f = fixture();
  await f.authority.initialize();
  f.runtime.session.createWallet = async () => { f.unlocked = true; };
  await rejectsCode(f.authority.create(PASSWORD), 'UNAVAILABLE');
  assert.equal(f.authority.getSnapshot().phase, 'unavailable');
  await rejectsCode(f.authority.create(PASSWORD), 'NOT_READY');
  assert.equal(f.unlocked, false);
});

test('synchronous disposal inside open waits for and closes the late runtime', async () => {
  const f = fixture(true);
  const release = deferred<CustodyRuntime>();
  let disposal: Promise<void> | undefined;
  let finished = false;
  const authority = new NativeCustodyAuthority({
    open() {
      disposal = authority.dispose();
      void disposal.then(() => { finished = true; });
      return release.promise;
    },
  });
  const opening = authority.initialize();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const finishedBeforeRuntime = finished;
  release.resolve(f.runtime);
  await opening;
  await disposal;
  assert.equal(finishedBeforeRuntime, false);
  assert.equal(f.events.filter((event) => event === 'close').length, 1);
  assert.equal(f.unlocked, false);
  assert.equal(authority.getSnapshot().phase, 'disposed');
});

test('a stale successful create/import still requires durable records before allowing onboarding', async () => {
  for (const operation of ['create', 'import'] as const) {
    const f = fixture();
    await f.authority.initialize();
    const entered = deferred<void>();
    const release = deferred<void>();
    const succeedWithoutCommit = async () => {
      entered.resolve(); await release.promise; f.unlocked = true;
    };
    f.runtime.session.createWallet = succeedWithoutCommit;
    f.runtime.session.importWallet = succeedWithoutCommit;
    const pending = operation === 'create'
      ? f.authority.create(PASSWORD)
      : f.authority.importPhrase(PHRASE, PASSWORD);
    await entered.promise;
    f.authority.lock();
    release.resolve();
    await rejectsCode(pending, 'CANCELLED');
    assert.equal(f.authority.getSnapshot().phase, 'unavailable');
    await rejectsCode(f.authority.create(PASSWORD), 'NOT_READY');
    assert.equal(f.unlocked, false);
  }
});

test('a failed create with a verified empty store may be retried', async () => {
  const f = fixture();
  await f.authority.initialize();
  const original = f.runtime.session.createWallet;
  f.runtime.session.createWallet = async () => { throw new Error('before commit'); };
  await rejectsCode(f.authority.create(PASSWORD), 'OPERATION_FAILED');
  assert.equal(f.authority.getSnapshot().phase, 'empty');
  f.runtime.session.createWallet = original;
  await f.authority.create(PASSWORD);
  assert.equal(f.authority.getSnapshot().phase, 'backup-required');
});

test('a read that completes after disposal cannot change the terminal snapshot', async () => {
  const f = fixture(true);
  const entered = deferred<void>();
  const state = deferred<CustodyStoredState>();
  f.runtime.storage.readState = async () => {
    entered.resolve(); return state.promise;
  };
  const opening = f.authority.initialize();
  await entered.promise;
  const disposal = f.authority.dispose();
  const terminal = f.authority.getSnapshot();
  state.resolve({ presence: 'existing', backup: 'confirmed' });
  await opening;
  await disposal;
  assert.equal(f.authority.getSnapshot(), terminal);
  assert.equal(f.events.at(-1), 'close');
});

test('initialization preserves quarantine after cleanup fails during its storage read', async () => {
  const f = fixture(true);
  const entered = deferred<void>();
  const state = deferred<CustodyStoredState>();
  f.runtime.storage.readState = async () => {
    entered.resolve(); return state.promise;
  };
  const opening = f.authority.initialize();
  await entered.promise;
  f.runtime.session.lock = async () => { throw new Error('cleanup failed'); };
  f.authority.lock();
  await Promise.resolve();
  assert.equal(f.authority.getSnapshot().phase, 'unavailable');
  state.resolve({ presence: 'existing', backup: 'confirmed' });
  await rejectsCode(opening, 'UNAVAILABLE');
  assert.equal(f.authority.getSnapshot().phase, 'unavailable');
  await rejectsCode(f.authority.unlock(PASSWORD), 'NOT_READY');
});

test('an unavailable observer requesting lock cannot sustain a rejected-cleanup event loop', async () => {
  const f = fixture(true);
  await f.authority.initialize();
  let lockCalls = 0;
  let notifications = 0;
  const originalLock = f.runtime.session.lock;
  f.runtime.session.lock = async () => {
    lockCalls++;
    await originalLock();
    throw new Error('cleanup failed');
  };
  f.authority.subscribe((state) => {
    if (state.phase === 'unavailable') {
      notifications++;
      // Bound the regression so the old implementation cannot hang the runner.
      if (notifications < 8) f.authority.lock();
    }
  });
  f.authority.lock();
  for (let i = 0; i < 100; i++) await Promise.resolve();
  assert.equal(f.authority.getSnapshot().phase, 'unavailable');
  assert.equal(lockCalls, 2);
  assert.equal(notifications, 2);
  // Quarantine suppresses repeated failure notifications, not actual cleanup.
  f.authority.lock();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(lockCalls, 3);
  assert.equal(f.unlocked, false);
});
