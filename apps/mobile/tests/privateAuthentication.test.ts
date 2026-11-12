import assert from 'node:assert/strict';
import test from 'node:test';
import { bindNativePrivateAuthentication, bindNativePrivateAuthenticationChild, createNativePrivateAuthenticationChild, createNativePrivateAuthenticationScope, withNativePrivateAuthentication, type NativePrivateAuthenticationScope } from '../src/custody/privateAuthentication.ts';
import { DeviceUnlockPrompt } from '../src/platform/deviceUnlockPrompt.ts';
import { createCredentialPort } from '../src/platform/credentialPort.ts';

const check = () => undefined;
const held = () => Promise.withResolvers<void>();
function fixture() {
  const scope = createNativePrivateAuthenticationScope();
  let prompt = false, live = true;
  const binding = bindNativePrivateAuthentication(scope, {
    assertCurrent() { if (!live) throw Error('retired wallet'); },
    isPromptActive: () => prompt,
  });
  return { scope, binding, prompt(value: boolean) { prompt = value; }, retireWallet() { live = false; } };
}
test('private authentication refuses forged and retired view scopes', async () => {
  const f = fixture();
  assert.throws(() => bindNativePrivateAuthentication({ isAuthenticating: () => true, retire() {} } as NativePrivateAuthenticationScope, { assertCurrent: check, isPromptActive: () => true }));
  f.scope.retire();
  assert.throws(() => bindNativePrivateAuthentication(f.scope, { assertCurrent: check, isPromptActive: () => true }));
  await assert.rejects(withNativePrivateAuthentication(f.binding, new AbortController().signal, check, async () => undefined));
});
test('only the active view and actual OS prompt allow an interruption; inactive guard does not recurse', async () => {
  const f = fixture(), other = fixture(), gate = held();
  let state = 'active', checks = 0;
  const viewGuard = () => { checks++; if (state !== 'active' && !(state === 'inactive' && f.scope.isAuthenticating())) throw Error('inactive view'); };
  const work = withNativePrivateAuthentication(f.binding, new AbortController().signal, check, async () => {
    await gate.promise; viewGuard();
  });
  assert.equal(f.scope.isAuthenticating(), false);
  f.prompt(true); other.prompt(true); state = 'inactive'; viewGuard();
  assert.equal(checks, 1); assert.equal(f.scope.isAuthenticating(), true); assert.equal(other.scope.isAuthenticating(), false);
  state = 'active'; f.prompt(false); gate.resolve(); await work;
  assert.equal(f.scope.isAuthenticating(), false);
});
for (const cause of ['signal', 'view', 'wallet'] as const) test(`private authentication ${cause} retirement clears a held prompt immediately`, async () => {
  const f = fixture(), gate = held(), controller = new AbortController();
  let signal!: AbortSignal;
  const work = withNativePrivateAuthentication(f.binding, controller.signal, check, async owned => { signal = owned; await gate.promise; });
  f.prompt(true); assert.equal(f.scope.isAuthenticating(), true);
  if (cause === 'signal') controller.abort();
  else if (cause === 'view') f.scope.retire();
  else f.retireWallet();
  assert.equal(f.scope.isAuthenticating(), false); assert.equal(signal.aborted, true);
  gate.resolve(); await assert.rejects(work);
});
test('overlapping and reused view scopes cannot overwrite or borrow an active proof', async () => {
  const f = fixture(), gate = held(); f.prompt(true);
  const work = withNativePrivateAuthentication(f.binding, new AbortController().signal, check, async () => gate.promise);
  const second = bindNativePrivateAuthentication(f.scope, { assertCurrent: check, isPromptActive: () => true });
  await assert.rejects(withNativePrivateAuthentication(second, new AbortController().signal, check, async () => undefined));
  assert.equal(f.scope.isAuthenticating(), true); gate.resolve(); await work;
  await withNativePrivateAuthentication(second, new AbortController().signal, check, async () => undefined);
  assert.equal(f.scope.isAuthenticating(), false);
});
test('private authentication failure clears only its own proof', async () => {
  const f = fixture(); f.prompt(true);
  await assert.rejects(withNativePrivateAuthentication(f.binding, new AbortController().signal, check, async () => { throw Error('refused'); }));
  assert.equal(f.scope.isAuthenticating(), false);
});

test('private authentication requires a synchronous true OS prompt result', async () => {
  for (const read of [() => false, () => undefined, () => ({}), () => Promise.resolve(true), () => Promise.reject(Error('async prompt'))]) {
    const scope = createNativePrivateAuthenticationScope(), gate = held();
    const binding = bindNativePrivateAuthentication(scope, { assertCurrent: check, isPromptActive: read as () => boolean });
    const work = withNativePrivateAuthentication(binding, new AbortController().signal, check, async () => gate.promise);
    assert.equal(scope.isAuthenticating(), false);
    gate.resolve(); await work;
  }
});

test('child cleanup preserves its parent and a fresh effect child without reviving the old one', async () => {
  const f = fixture(); f.prompt(true);
  const first = createNativePrivateAuthenticationChild(f.scope);
  const firstBinding = bindNativePrivateAuthenticationChild(f.binding, first);
  const gate = held();
  let signal!: AbortSignal;
  const pending = withNativePrivateAuthentication(firstBinding, new AbortController().signal, check, async owned => { signal = owned; await gate.promise; });
  assert.equal(first.isAuthenticating(), true);
  assert.equal(f.scope.isAuthenticating(), true);
  first.retire(); assert.equal(signal.aborted, true);
  assert.equal(f.scope.isAuthenticating(), false);
  gate.resolve(); await assert.rejects(pending);
  assert.throws(() => bindNativePrivateAuthenticationChild(f.binding, first));
  const second = createNativePrivateAuthenticationChild(f.scope);
  const secondBinding = bindNativePrivateAuthenticationChild(f.binding, second);
  await withNativePrivateAuthentication(secondBinding, new AbortController().signal, check, async () => {
    assert.equal(second.isAuthenticating(), true);
    assert.equal(first.isAuthenticating(), false);
    assert.equal(f.scope.isAuthenticating(), true);
  });
  assert.equal(f.scope.isAuthenticating(), false);
});
test('parent retirement cancels its child and excludes sibling or foreign proof adoption', async () => {
  const f = fixture(), foreign = fixture(); f.prompt(true);
  const child = createNativePrivateAuthenticationChild(f.scope), sibling = createNativePrivateAuthenticationChild(f.scope);
  const binding = bindNativePrivateAuthenticationChild(f.binding, child);
  assert.throws(() => bindNativePrivateAuthenticationChild(f.binding, f.scope));
  assert.throws(() => bindNativePrivateAuthenticationChild(foreign.binding, child));
  const grandchild = createNativePrivateAuthenticationChild(child);
  assert.throws(() => bindNativePrivateAuthenticationChild(f.binding, grandchild));
  const gate = held(); let signal!: AbortSignal;
  const work = withNativePrivateAuthentication(binding, new AbortController().signal, check, async owned => { signal = owned; await gate.promise; });
  assert.equal(f.scope.isAuthenticating(), true); assert.equal(sibling.isAuthenticating(), false);
  await assert.rejects(withNativePrivateAuthentication(bindNativePrivateAuthenticationChild(f.binding, sibling), new AbortController().signal, check, async () => undefined));
  f.scope.retire(); assert.equal(signal.aborted, true);
  assert.equal(child.isAuthenticating(), false);
  assert.throws(() => createNativePrivateAuthenticationChild(f.scope));
  assert.throws(() => bindNativePrivateAuthenticationChild(f.binding, sibling));
  gate.resolve(); await assert.rejects(work);
});

test('a cancelled native read cannot lend prompt status to a successor or secret consumer', async () => {
  const prompt = new DeviceUnlockPrompt({ state: () => 'active', subscribe: () => () => {} });
  const gates = [held(), held()];
  let reads = 0, consumed = 0;
  const reference = { version: 1 as const, installationId: '11'.repeat(16), walletBindingId: '22'.repeat(32), pairFingerprint: '33'.repeat(32), enrollmentId: '44'.repeat(16) };
  const port = createCredentialPort({
    language: () => 'en',
    native: {
      credentialCapabilities: async () => ({ deviceAuth: 'ready', credentialPresent: true }),
      isCredentialPromptActive: () => false,
      prepareCredentialRead() {
        const gate = gates[reads++]!;
        return { cancel() {}, async run() { await gate.promise; return `Pali#1:${'55'.repeat(32)}`; } };
      },
      prepareCredentialStage() { throw Error('unexpected stage'); },
      prepareCredentialAuthorization() { throw Error('unexpected authorization'); },
      async removeCredential() {},
    },
    publicStore: { async get() { return null; }, async set() {}, async remove() {} },
    prompt: (owner, work) => prompt.run(owner, work), setActive() {},
  });
  const scope = createNativePrivateAuthenticationScope();
  const binding = bindNativePrivateAuthentication(scope, { assertCurrent: check, isPromptActive: owner => prompt.isActive(owner) });
  const owners: AbortSignal[] = [];
  const start = (controller: AbortController) => withNativePrivateAuthentication(binding, controller.signal, check, async owner => {
    owners.push(owner);
    await port.withSecret(reference, { signal: owner, assertCurrent: check, purpose: 'message' }, async () => {
      assert.equal(scope.isAuthenticating(), false, 'The OS prompt is cleared before secret consumption');
      consumed++;
    });
  });
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));
  try {
    const first = new AbortController(), rejected = assert.rejects(start(first));
    await tick(); assert.equal(scope.isAuthenticating(), true);
    first.abort();
    assert.equal(prompt.isAnyPromptActive(), false);
    assert.equal(scope.isAuthenticating(), false);
    gates[0]!.resolve(); await rejected; await tick();
    assert.equal(consumed, 0, 'Late cancelled native completion never supplies the secret');
    const second = start(new AbortController());
    await tick(); assert.equal(scope.isAuthenticating(), true);
    assert.notEqual(owners[0], owners[1]);
    assert.equal(prompt.isActive(owners[0]!), false);
    assert.equal(prompt.isActive(owners[1]!), true);
    gates[1]!.resolve(); await second;
    assert.equal(consumed, 1); assert.equal(scope.isAuthenticating(), false);
  } finally { gates.forEach(gate => gate.resolve()); scope.retire(); }
});
