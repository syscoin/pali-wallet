import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationAuthentication, isOperationAuthenticationCancellation, type OperationAuthenticationPrompt } from '../src/core/operationAuthentication.ts';
import type { NativeOperationCredential, NativeOperationCredentialVerification } from '../src/custody/types.ts';

const request = Object.freeze({ id: 'test-operation', purpose: 'transaction' as const, biometricsEnabled: true });
const accept = async (_credential: NativeOperationCredential, check: () => void): Promise<NativeOperationCredentialVerification> => { check(); return { accepted: true }; };
function fixture() {
  const broker = new OperationAuthentication(), abort = new AbortController();
  let prompt: OperationAuthenticationPrompt | null = null, current = true;
  const detach = broker.attach(value => { prompt = value; });
  const guard = () => { if (!current) throw new Error('CANCELLED'); };
  return { broker, abort, detach, guard, get prompt() { return prompt; }, revoke() { current = false; } };
}

test('credentials are returned only to one current operation after explicit confirmation', async () => {
  const f = fixture();
  const pending = f.broker.request(request, f.abort.signal, f.guard, accept);
  const prompt = f.prompt!; assert(prompt);
  await assert.rejects(f.broker.request({ ...request, id: 'other' }, f.abort.signal, f.guard, accept), /BUSY/);
  prompt.confirm({ method: 'pin', pin: '123456' });
  assert.equal(f.prompt?.busy, true);
  assert.equal(await pending, undefined);
  assert.equal(f.prompt, null);
  prompt.confirm({ method: 'pin', pin: '654321' }); f.detach();
});

test('old callbacks cannot complete a replacement prompt', async () => {
  const f = fixture();
  const first = f.broker.request(request, f.abort.signal, f.guard, accept), old = f.prompt!;
  old.cancel(); await assert.rejects(first, error => isOperationAuthenticationCancellation(error));
  const second = f.broker.request({ ...request, id: 'new' }, f.abort.signal, f.guard, accept), next = f.prompt!;
  old.confirm({ method: 'biometric' }); assert.equal(f.prompt, next);
  next.confirm({ method: 'biometric' }); assert.equal(await second, undefined); f.detach();
});

for (const action of ['abort', 'detach', 'revoke', 'cancel'] as const) test(`${action} rejects the captured operation and discards credentials`, async () => {
  const f = fixture(); const pending = f.broker.request(request, f.abort.signal, f.guard, accept), prompt = f.prompt!;
  if (action === 'abort') f.abort.abort();
  if (action === 'detach') f.detach();
  if (action === 'cancel') f.broker.cancel();
  if (action === 'revoke') f.revoke();
  prompt.confirm({ method: 'pin', pin: '123456' });
  await assert.rejects(pending, error => {
    assert(error instanceof Error); assert.equal(error.message, 'CANCELLED');
    assert.equal(isOperationAuthenticationCancellation(error), false); return true;
  }); f.detach();
});

test('no host, malformed PIN and unenrolled biometric authentication fail closed', async () => {
  const noHost = new OperationAuthentication();
  await assert.rejects(noHost.request(request, new AbortController().signal, () => {}, accept), /CANCELLED/);
  for (const credential of [{ method: 'pin', pin: 'short' }, { method: 'biometric' }] as const) {
    const f = fixture(); const pending = f.broker.request({ ...request, biometricsEnabled: false }, f.abort.signal, f.guard, accept);
    f.prompt!.confirm(credential); await assert.rejects(pending, /CANCELLED/); f.detach();
  }
});

test('guard changes while the prompt is closing still reject the returned credential', async () => {
  const broker = new OperationAuthentication(); let prompt: OperationAuthenticationPrompt | null = null, current = true;
  const detach = broker.attach(value => { prompt = value; if (!value) current = false; });
  const pending = broker.request(request, new AbortController().signal, () => { if (!current) throw new Error('CANCELLED'); }, accept);
  prompt!.confirm({ method: 'pin', pin: '123456' }); await assert.rejects(pending, /CANCELLED/); detach();
});

test('unknown credential methods and accessor fields are rejected without invoking getters', async () => {
  let accessed = false;
  for (const invalid of [{ method: 'unexpected' }, { get method() { accessed = true; return 'pin'; }, pin: '123456' }]) {
    const f = fixture(), pending = f.broker.request({ ...request, biometricsEnabled: false }, f.abort.signal, f.guard, accept);
    f.prompt!.confirm(invalid as never); await assert.rejects(pending, /CANCELLED/); f.detach();
  }
  assert.equal(accessed, false);
});

test('expired confirmations are rejected even when the timeout callback has not run', async () => {
  let now = 0, prompt: OperationAuthenticationPrompt | null = null;
  const broker = new OperationAuthentication(() => now), detach = broker.attach(value => { prompt = value; });
  const pending = broker.request(request, new AbortController().signal, () => {}, accept);
  now = 90_000; prompt!.confirm({ method: 'pin', pin: '123456' });
  await assert.rejects(pending, /CANCELLED/); detach();
});

test('credential fields are captured before the host closes the prompt', async () => {
  let prompt: OperationAuthenticationPrompt | null = null;
  const credential = { method: 'pin' as const, pin: '123456' };
  const broker = new OperationAuthentication(), detach = broker.attach(value => { prompt = value; if (!value) credential.pin = '654321'; });
  let verified: NativeOperationCredential | undefined;
  const pending = broker.request(request, new AbortController().signal, () => {}, async (value, check) => {
    verified = value; check(); return { accepted: true };
  });
  prompt!.confirm(credential); await pending; assert.deepEqual(verified, { method: 'pin', pin: '123456' }); detach();
});

test('explicit cancellation loses its preservation proof when the host guard changes', async () => {
  let prompt: OperationAuthenticationPrompt | null = null, current = true;
  const broker = new OperationAuthentication();
  const detach = broker.attach(value => { prompt = value; if (!value) current = false; });
  const pending = broker.request(request, new AbortController().signal, () => { if (!current) throw new Error('CANCELLED'); }, accept);
  prompt!.cancel();
  await assert.rejects(pending, error => !isOperationAuthenticationCancellation(error));
  assert.equal(isOperationAuthenticationCancellation(new Error('CANCELLED')), false);
  detach();
});

test('verified biometric refusal keeps one prompt for PIN fallback and prevents duplicate verification', async () => {
  const f = fixture();
  const held = Promise.withResolvers<NativeOperationCredentialVerification>();
  const verified: NativeOperationCredential[] = [];
  const pending = f.broker.request(request, f.abort.signal, f.guard, async (credential, check) => {
    verified.push(credential); check();
    return credential.method === 'biometric' ? held.promise : { accepted: true };
  });
  const initial = f.prompt!;
  initial.confirm({ method: 'biometric' }); initial.confirm({ method: 'biometric' });
  assert.equal(verified.length, 1); assert.equal(f.prompt?.busy, true);
  held.resolve({ accepted: false, reason: 'DEVICE_UNLOCK_UNAVAILABLE' });
  await held.promise; await new Promise(resolve => setImmediate(resolve));
  const fallback = f.prompt!;
  assert.equal(fallback.request.id, initial.request.id);
  assert.equal(fallback.busy, false); assert.match(fallback.error!, /Enter your PIN/);
  fallback.confirm({ method: 'pin', pin: '123456' }); await pending;
  assert.deepEqual(verified.map(value => value.method), ['biometric', 'pin']);
  assert.equal(f.prompt, null); f.detach();
});

test('fatal verification failure closes the prompt instead of offering a retry', async () => {
  const f = fixture(), failure = Error('STORAGE_CHANGED');
  const pending = f.broker.request(request, f.abort.signal, f.guard, async () => { throw failure; });
  f.prompt!.confirm({ method: 'biometric' });
  await assert.rejects(pending, error => error === failure);
  assert.equal(f.prompt, null); f.detach();
});

test('cancel during verification retires that attempt and cannot settle its successor', async () => {
  const f = fixture(), held = Promise.withResolvers<void>();
  let checkOld!: () => void;
  const pending = f.broker.request(request, f.abort.signal, f.guard, async (_credential, check) => {
    checkOld = check; await held.promise; check(); return { accepted: true };
  });
  f.prompt!.confirm({ method: 'biometric' });
  f.prompt!.cancel(); await assert.rejects(pending, error => isOperationAuthenticationCancellation(error));
  assert.throws(checkOld, /CANCELLED/);
  const next = f.broker.request({ ...request, id: 'successor' }, f.abort.signal, f.guard, accept);
  const successor = f.prompt!;
  held.resolve(); await held.promise; await Promise.resolve();
  assert.equal(f.prompt, successor);
  successor.confirm({ method: 'pin', pin: '654321' }); await next; f.detach();
});
