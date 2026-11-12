import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceUnlockPrompt } from '../src/platform/deviceUnlockPrompt.ts';
import { createCredentialPort, createPublicViewAuthorizer, credentialPromptActivityState, isNonBackgroundNativePromptActive, type NativeCredentialModule, type NativeCredentialRequest } from '../src/platform/credentialPort.ts';
import { isOperationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';
const reference = Object.freeze({ version: 1 as const, installationId: '11'.repeat(16), walletBindingId: '22'.repeat(32), pairFingerprint: '33'.repeat(32), enrollmentId: '44'.repeat(16) });
const secret = `Pali#1:${'ab'.repeat(32)}`;
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture() {
  const entries = new Map<string, string>(), signal = new AbortController(), calls: string[] = [];
  let valid = true, active: NativeCredentialRequest | null = null, result: Promise<unknown> = Promise.resolve(secret);
  const request = () => ({ run: () => result, cancel: () => { calls.push('cancel'); } });
  const native: NativeCredentialModule = {
    isCredentialPromptActive: () => false, credentialCapabilities: async () => ({ deviceAuth: 'ready', credentialPresent: true }),
    prepareCredentialAuthorization: binding => { calls.push(`authorize:${binding}`); return request(); },
    prepareCredentialRead: binding => { calls.push(`read:${binding}`); return request(); },
    prepareCredentialStage: binding => { calls.push(`stage:${binding}`); return request(); }, removeCredential: async () => { calls.push('remove'); } };
  const ports = { native, publicStore: { get: async (name: string) => entries.get(name) ?? null, set: async (name: string, value: string) => { entries.set(name, value); }, remove: async (name: string) => { entries.delete(name); } },
    prompt: async <T>(_signal: AbortSignal, work: () => Promise<T>) => work(), setActive: (value: NativeCredentialRequest | null) => { if (value && active) throw Error('busy'); active = value; } };
  const owner = { signal: signal.signal, assertCurrent: () => { if (!valid) throw Error('stale'); }, purpose: 'secret-read' as const };
  return { port: createCredentialPort(ports), second: () => createCredentialPort(ports), owner, signal, calls, entries, setResult: (value: Promise<unknown>) => { result = value; }, retire: () => { valid = false; }, active: () => active };
}
test('public entry and readiness never request protected credentials', async () => {
  const f = fixture(); assert.deepEqual(await f.port.capabilities(reference), { deviceAuth: 'ready', credentialPresent: true });
  assert.equal(await f.port.readPublic(reference, f.owner.assertCurrent), null); assert.deepEqual(f.calls, []);
});
test('protected reads are fresh and only current owner receives the secret', async () => {
  const f = fixture(), gate = deferred<unknown>(); f.setResult(gate.promise); let consumed = 0;
  const read = f.port.withSecret(reference, f.owner, async value => { assert.equal(value, secret); consumed++; return 7; });
  assert.equal(consumed, 0); gate.resolve(secret); assert.equal(await read, 7);
  await f.port.withSecret(reference, f.owner, async () => { consumed++; }); assert.equal(consumed, 2); assert.equal(f.calls.filter(x => x.startsWith('read:')).length, 2);
});
test('late OS success after cancellation is discarded', async () => {
  const f = fixture(), gate = deferred<unknown>(); f.setResult(gate.promise); let consumed = false;
  const read = f.port.withSecret(reference, f.owner, async () => { consumed = true; }); const rejection = assert.rejects(read);
  f.signal.abort(); gate.resolve(secret); await rejection; assert.equal(consumed, false); assert.equal(f.active(), null); assert(f.calls.includes('cancel'));
});
test('a second request cannot replace the first pending native owner', async () => {
  const f = fixture(), gate = deferred<unknown>(); f.setResult(gate.promise);
  const first = f.port.withSecret(reference, f.owner, async () => undefined), held = f.active();
  await assert.rejects(f.second().withSecret(reference, f.owner, async () => undefined)); assert.equal(f.active(), held); gate.resolve(secret); await first;
});
test('only genuine OS cancellation receives the user refusal brand', async () => {
  for (const code of ['CREDENTIAL_USER_CANCELLED', 'CREDENTIAL_MISSING', 'CREDENTIAL_UNSUPPORTED', 'CREDENTIAL_UNAVAILABLE']) {
    const f = fixture(); f.setResult(Promise.reject(Object.assign(Error('redacted'), { code })));
    await assert.rejects(f.port.withSecret(reference, f.owner, async () => undefined), error => { assert.equal(isOperationAuthenticationCancellation(error), code === 'CREDENTIAL_USER_CANCELLED'); return true; });
  }
});
test('staging writes only checkpoint data after OS success; removal covers both aliases', async () => {
  const f = fixture(), gate = deferred<unknown>(); f.setResult(gate.promise); const key = new Uint8Array(32).fill(5);
  const stage = f.port.stage(reference, { secret, publicKey: key }, f.owner); key.fill(0); assert.equal(f.entries.size, 0); await Promise.resolve(); gate.resolve(null); await stage;
  assert.equal(f.entries.size, 1); assert(![...f.entries.values()][0]!.includes(secret)); assert.deepEqual(await f.port.readPublic(reference, f.owner.assertCurrent), new Uint8Array(32).fill(5));
  await f.port.remove(reference); assert.equal(f.entries.size, 0);
});
test('staging rejects existing aliases, getters and retired owners', async () => {
  const f = fixture(); f.setResult(Promise.resolve(null)); await f.port.stage(reference, { secret, publicKey: new Uint8Array(32) }, f.owner);
  await assert.rejects(f.port.stage(reference, { secret, publicKey: new Uint8Array(32) }, f.owner));
  const g = fixture(), value = { get secret(): string { throw Error('getter'); }, publicKey: new Uint8Array(32) };
  await assert.rejects(g.port.stage(reference, value, g.owner)); assert.equal(g.calls.length, 0); g.retire(); await assert.rejects(g.port.withSecret(reference, g.owner, async () => undefined)); assert.equal(g.calls.length, 0);
});

test('only native-owned Android credential UI preserves the exact prompt through system Activity pause', async () => {
  let state = 'active', nativeActive = false;
  const events = new Set<(value: string) => void>();
  const native = { isCredentialPromptActive: () => nativeActive };
  const mapped = (value: string) => credentialPromptActivityState('android', value, native);
  const prompt = new DeviceUnlockPrompt({ state: () => mapped(state), subscribe(listener) { events.add(listener); return () => { events.delete(listener); }; } });
  const emit = (value: string) => { state = value; for (const listener of events) listener(mapped(value)); };
  const owner = new AbortController(), unrelated = new AbortController();
  let finish!: () => void;
  const result = prompt.run(owner.signal, () => new Promise<void>(resolve => { finish = resolve; }));
  nativeActive = true; emit('background');
  assert.equal(prompt.isActive(owner.signal), true);
  assert.equal(prompt.isActive(unrelated.signal), false);
  emit('active'); nativeActive = false; finish(); await result;
  assert.equal(prompt.isAnyPromptActive(), false);
  let rejectFinish!: () => void;
  const rejected = prompt.run(owner.signal, () => new Promise<void>(resolve => { rejectFinish = resolve; }));
  emit('background'); assert.equal(prompt.isAnyPromptActive(), false);
  emit('active'); rejectFinish(); await assert.rejects(rejected);
  assert.equal(credentialPromptActivityState('ios', 'background', { isCredentialPromptActive: () => true }), 'background');
  assert.equal(credentialPromptActivityState('android', 'unknown', { isCredentialPromptActive: () => true }), 'unknown');
});

test('settings authorization uses native proof without reading or returning the vault secret', async () => {
  const f = fixture(); f.setResult(Promise.resolve(null));
  await f.port.authorize(reference, f.owner);
  assert.equal(f.calls.filter(value => value.startsWith('authorize:')).length, 1);
  assert.equal(f.calls.filter(value => value.startsWith('read:')).length, 0);
  f.setResult(Promise.resolve(secret)); await assert.rejects(f.port.authorize(reference, f.owner));
});

test('a passkey prompt cannot borrow the native credential background window or another owner', () => {
  const owner = new AbortController(), other = new AbortController();
  const nativeActive = (signal: AbortSignal) => signal === owner.signal;
  const passkeyActive = (signal: AbortSignal) => signal === owner.signal;
  const native = { isCredentialPromptActive: () => true };
  assert.equal(credentialPromptActivityState('android', 'background', native), 'inactive');
  assert.equal(nativeActive(owner.signal), true);
  assert.equal(nativeActive(other.signal), false);
  assert.equal(isNonBackgroundNativePromptActive('inactive', () => passkeyActive(owner.signal)), true);
  assert.equal(isNonBackgroundNativePromptActive('inactive', () => passkeyActive(other.signal)), false);
  assert.equal(isNonBackgroundNativePromptActive('background', () => passkeyActive(owner.signal)), false);
});

test('public-view authentication has no credential or storage capability and refuses a secret result', async () => {
  let active: NativeCredentialRequest | null = null, prompts = 0, requests = 0, result: unknown = null;
  const authorize = createPublicViewAuthorizer({
    native: { prepareViewAuthorization() { requests++; return { run: async () => result, cancel() {} }; } },
    prompt: async (_signal, work) => { prompts++; return work(); },
    setActive: value => { active = value; },
  });
  const owner = new AbortController();
  await authorize(owner.signal, () => undefined);
  await authorize(owner.signal, () => undefined);
  assert.equal(requests, 2); assert.equal(prompts, 2); assert.equal(active, null);
  result = secret;
  await assert.rejects(authorize(owner.signal, () => undefined), /CREDENTIAL_UNAVAILABLE/);
});

test('public-view authentication discards late success after cancellation or changed ownership', async () => {
  for (const reason of ['abort', 'owner']) {
    const held = Promise.withResolvers<unknown>(), owner = new AbortController();
    let current = true, cancelled = 0, active: NativeCredentialRequest | null = null;
    const authorize = createPublicViewAuthorizer({
      native: { prepareViewAuthorization: () => ({ run: () => held.promise, cancel() { cancelled++; } }) },
      prompt: async (_signal, work) => work(), setActive: value => { active = value; },
    });
    const work = authorize(owner.signal, () => { if (!current) throw Error('CANCELLED'); });
    const rejected = assert.rejects(work);
    if (reason === 'abort') owner.abort(); else current = false;
    held.resolve(null); await rejected;
    assert.equal(active, null); assert(cancelled > 0);
  }
});
