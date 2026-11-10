import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationAuthentication, isOperationAuthenticationCancellation, type OperationAuthenticationPrompt } from '../src/core/operationAuthentication.ts';

const request = Object.freeze({ id: 'test-operation', purpose: 'transaction' as const, biometricsEnabled: true });
function fixture() {
  const broker = new OperationAuthentication(), abort = new AbortController();
  let prompt: OperationAuthenticationPrompt | null = null, current = true;
  const detach = broker.attach(value => { prompt = value; });
  const guard = () => { if (!current) throw new Error('CANCELLED'); };
  return { broker, abort, detach, guard, get prompt() { return prompt; }, revoke() { current = false; } };
}

test('credentials are returned only to one current operation after explicit confirmation', async () => {
  const f = fixture();
  const pending = f.broker.request(request, f.abort.signal, f.guard);
  const prompt = f.prompt!; assert(prompt);
  await assert.rejects(f.broker.request({ ...request, id: 'other' }, f.abort.signal, f.guard), /BUSY/);
  prompt.confirm({ method: 'pin', pin: '123456' });
  assert.equal(f.prompt, null);
  assert.deepEqual(await pending, { method: 'pin', pin: '123456' });
  prompt.confirm({ method: 'pin', pin: '654321' }); f.detach();
});

test('old callbacks cannot complete a replacement prompt', async () => {
  const f = fixture();
  const first = f.broker.request(request, f.abort.signal, f.guard), old = f.prompt!;
  old.cancel(); await assert.rejects(first, error => isOperationAuthenticationCancellation(error));
  const second = f.broker.request({ ...request, id: 'new' }, f.abort.signal, f.guard), next = f.prompt!;
  old.confirm({ method: 'biometric' }); assert.equal(f.prompt, next);
  next.confirm({ method: 'biometric' }); assert.deepEqual(await second, { method: 'biometric' }); f.detach();
});

for (const action of ['abort', 'detach', 'revoke', 'cancel'] as const) test(`${action} rejects the captured operation and discards credentials`, async () => {
  const f = fixture(); const pending = f.broker.request(request, f.abort.signal, f.guard), prompt = f.prompt!;
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
  await assert.rejects(noHost.request(request, new AbortController().signal, () => {}), /CANCELLED/);
  for (const credential of [{ method: 'pin', pin: 'short' }, { method: 'biometric' }] as const) {
    const f = fixture(); const pending = f.broker.request({ ...request, biometricsEnabled: false }, f.abort.signal, f.guard);
    f.prompt!.confirm(credential); await assert.rejects(pending, /CANCELLED/); f.detach();
  }
});

test('guard changes while the prompt is closing still reject the returned credential', async () => {
  const broker = new OperationAuthentication(); let prompt: OperationAuthenticationPrompt | null = null, current = true;
  const detach = broker.attach(value => { prompt = value; if (!value) current = false; });
  const pending = broker.request(request, new AbortController().signal, () => { if (!current) throw new Error('CANCELLED'); });
  prompt!.confirm({ method: 'pin', pin: '123456' }); await assert.rejects(pending, /CANCELLED/); detach();
});

test('unknown credential methods and accessor fields are rejected without invoking getters', async () => {
  let accessed = false;
  for (const invalid of [{ method: 'unexpected' }, { get method() { accessed = true; return 'pin'; }, pin: '123456' }]) {
    const f = fixture(), pending = f.broker.request({ ...request, biometricsEnabled: false }, f.abort.signal, f.guard);
    f.prompt!.confirm(invalid as never); await assert.rejects(pending, /CANCELLED/); f.detach();
  }
  assert.equal(accessed, false);
});

test('expired confirmations are rejected even when the timeout callback has not run', async () => {
  let now = 0, prompt: OperationAuthenticationPrompt | null = null;
  const broker = new OperationAuthentication(() => now), detach = broker.attach(value => { prompt = value; });
  const pending = broker.request(request, new AbortController().signal, () => {});
  now = 90_000; prompt!.confirm({ method: 'pin', pin: '123456' });
  await assert.rejects(pending, /CANCELLED/); detach();
});

test('credential fields are captured before the host closes the prompt', async () => {
  let prompt: OperationAuthenticationPrompt | null = null;
  const credential = { method: 'pin' as const, pin: '123456' };
  const broker = new OperationAuthentication(), detach = broker.attach(value => { prompt = value; if (!value) credential.pin = '654321'; });
  const pending = broker.request(request, new AbortController().signal, () => {});
  prompt!.confirm(credential); assert.deepEqual(await pending, { method: 'pin', pin: '123456' }); detach();
});

test('explicit cancellation loses its preservation proof when the host guard changes', async () => {
  let prompt: OperationAuthenticationPrompt | null = null, current = true;
  const broker = new OperationAuthentication();
  const detach = broker.attach(value => { prompt = value; if (!value) current = false; });
  const pending = broker.request(request, new AbortController().signal, () => { if (!current) throw new Error('CANCELLED'); });
  prompt!.cancel();
  await assert.rejects(pending, error => !isOperationAuthenticationCancellation(error));
  assert.equal(isOperationAuthenticationCancellation(new Error('CANCELLED')), false);
  detach();
});
