import assert from 'node:assert/strict';
import test from 'node:test';
import { createPasskeyPresentation } from '../src/platform/passkeyPresentation.ts';

function fixture() {
  let state = 'active';
  const listeners = new Set<(state: string) => void>();
  const presentation = createPasskeyPresentation({ state: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } });
  return { presentation, listeners, move(next: string) { if (next !== 'focus' && next !== 'blur') state = next; for (const listener of listeners) listener(next); } };
}
test('a public passkey response waits for exact-owner foreground and focus after OS completion', async () => {
  const f = fixture(), owner = new AbortController(); let delivered = false;
  const pending = f.presentation.run(owner.signal, async () => { f.move('inactive'); f.move('blur'); return 'public-response'; })
    .then(value => { delivered = true; return value; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(delivered, false); assert.equal(f.presentation.isActive(owner.signal), true);
  assert.equal(f.presentation.isActive(new AbortController().signal), false);
  f.move('active'); await Promise.resolve(); assert.equal(delivered, false);
  f.move('focus'); assert.equal(await pending, 'public-response'); assert.equal(f.listeners.size, 0);
});
test('real backgrounding and cancellation discard the public passkey response', async () => {
  for (const cancelOwner of [false, true]) {
    const f = fixture(), owner = new AbortController();
    const pending = f.presentation.run(owner.signal, async () => { f.move('inactive'); return 'public-response'; });
    await new Promise<void>(resolve => setImmediate(resolve));
    if (cancelOwner) owner.abort(); else f.move('background');
    await assert.rejects(pending); assert.equal(f.presentation.isActive(), false); assert.equal(f.listeners.size, 0);
  }
});
