import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAppUpdateAdapter, unavailableAppUpdateState,
  type AppUpdateMode, type AppUpdateNativePort, type AppUpdateState,
} from '../index.ts';

function fixture() {
  let next = 0;
  let listener: ((state: AppUpdateState) => void) | undefined;
  const calls: string[] = [];
  const tickets = new Map<string, { crossed: boolean; reject?: (error: Error) => void }>();
  let release: (() => void) | undefined;
  let held = false;
  const state: AppUpdateState = {
    ...unavailableAppUpdateState, supported: true, storeAvailable: true,
    availability: 'available', availableVersionCode: 2, priority: 5, flexibleAllowed: true, immediateAllowed: true,
  };
  const enter = async (token: string, action: string) => {
    calls.push(action);
    const ticket = tickets.get(token);
    if (!ticket) throw Object.assign(new Error('cancelled'), { code: 'APP_UPDATE_CANCELLED' });
    if (held) await new Promise<void>((resolve, reject) => {
      release = resolve;
      ticket.reject = reject;
    });
    if (!tickets.has(token)) throw Object.assign(new Error('cancelled'), { code: 'APP_UPDATE_CANCELLED' });
    ticket.crossed = true;
  };
  const native: AppUpdateNativePort = {
    async check() { calls.push('check'); return state; },
    prepareUpdate() { const token = String(++next); calls.push(`prepare:${token}`); tickets.set(token, { crossed: false }); return token; },
    cancelPendingUpdate(token) {
      calls.push(`cancel:${token}`);
      const ticket = tickets.get(token);
      if (!ticket || ticket.crossed) return false;
      tickets.delete(token);
      ticket.reject?.(Object.assign(new Error('cancelled'), { code: 'APP_UPDATE_CANCELLED' }));
      return true;
    },
    async start(token, mode) { await enter(token, `start:${mode}`); return 'accepted'; },
    async complete(token) { await enter(token, 'complete'); },
    addListener(event, callback) {
      calls.push(event);
      listener = callback;
      return { remove() { listener = undefined; calls.push('remove'); } };
    },
  };
  return {
    native, calls, state, adapter: createAppUpdateAdapter(() => native),
    hold() { held = true; },
    release() { held = false; release?.(); },
    emit(value: AppUpdateState) { listener?.(value); },
  };
}

test('unsupported hosts expose unavailable state and never report an installation', async () => {
  const adapter = createAppUpdateAdapter(() => null);
  assert.equal(await adapter.checkAppUpdate(), unavailableAppUpdateState);
  assert.equal(await adapter.startAppUpdate(), 'unavailable');
  await assert.rejects(adapter.completeAppUpdate(), /APP_UPDATE_UNAVAILABLE/);
  adapter.subscribeAppUpdates(() => assert.fail('unsupported host emitted an update'))();
});

test('querying and receiving a downloaded update do not start or complete it', async () => {
  const f = fixture();
  assert.equal(await f.adapter.checkAppUpdate(), f.state);
  const seen: AppUpdateState[] = [];
  const remove = f.adapter.subscribeAppUpdates((state) => seen.push(state));
  f.emit({ ...f.state, installStatus: 'downloaded' });
  assert.equal(seen[0]?.installStatus, 'downloaded');
  assert.deepEqual(f.calls, ['check', 'onUpdateState']);
  remove();
  f.emit(f.state);
  assert.equal(seen.length, 1);
});

test('the default start is flexible even for priority five; immediate and complete each need their own call', async () => {
  const f = fixture();
  assert.equal(await f.adapter.startAppUpdate(), 'accepted');
  assert.deepEqual(f.calls, ['prepare:1', 'start:flexible', 'cancel:1']);
  assert.equal(await f.adapter.startAppUpdate('immediate'), 'accepted');
  assert.equal(f.calls.filter((call) => call === 'start:immediate').length, 1);
  assert.equal(f.calls.includes('complete'), false);
  await f.adapter.completeAppUpdate();
  assert.equal(f.calls.filter((call) => call === 'complete').length, 1);
});

test('invalid mode and an already aborted action cannot allocate native authority', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.adapter.startAppUpdate('invalid' as AppUpdateMode), /APP_UPDATE_INVALID_MODE/);
  await assert.rejects(f.adapter.startAppUpdate('flexible', controller.signal), { name: 'AbortError' });
  await assert.rejects(f.adapter.completeAppUpdate(controller.signal), { name: 'AbortError' });
  assert.deepEqual(f.calls, []);
});

test('an abort during native preparation cancels its token before calling start', async () => {
  const f = fixture();
  const controller = new AbortController();
  const prepare = f.native.prepareUpdate;
  f.native.prepareUpdate = () => { const token = prepare(); controller.abort(); return token; };
  await assert.rejects(f.adapter.startAppUpdate('flexible', controller.signal), { name: 'AbortError' });
  assert.deepEqual(f.calls, ['prepare:1', 'cancel:1', 'cancel:1']);
});

for (const action of ['start', 'complete'] as const) {
  test(`abort during ${action} preflight cancels the native request and permits a fresh retry`, async () => {
    const f = fixture();
    f.hold();
    const controller = new AbortController();
    const pending = action === 'start'
      ? f.adapter.startAppUpdate('flexible', controller.signal)
      : f.adapter.completeAppUpdate(controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    f.release();
    if (action === 'start') assert.equal(await f.adapter.startAppUpdate(), 'accepted');
    else await f.adapter.completeAppUpdate();
    assert.equal(f.calls.filter((call) => call === 'prepare:2').length, 1);
    const before = f.calls.length;
    controller.abort();
    assert.equal(f.calls.length, before);
  });
}

test('an abort after Play has started cannot falsely report that Play was cancelled', async () => {
  const f = fixture();
  const controller = new AbortController();
  const original = f.native.start;
  f.native.start = async (token, mode) => {
    const result = await original(token, mode);
    controller.abort();
    return result;
  };
  assert.equal(await f.adapter.startAppUpdate('flexible', controller.signal), 'accepted');
  assert.deepEqual(f.calls, ['prepare:1', 'start:flexible', 'cancel:1', 'cancel:1']);
});
