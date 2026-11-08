import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
  extractPairingUri,
  NativePairingInbox,
  observePairingLinks,
} from '../src/connections/pairingLinks.ts';

const URI = `wc:${'ab'.repeat(32)}@2?relay-protocol=irn&symKey=${'cd'.repeat(
  32
)}`;
const link = (uri = URI) => `pali://wc?uri=${encodeURIComponent(uri)}`;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

for (const value of [URI, link()]) {
  test(`extracts ${
    value === URI ? 'raw QR/paste input' : 'encoded OS link'
  } without interpreting pairing permissions`, () => {
    assert.equal(extractPairingUri(value), URI);
  });
}
for (const value of [
  undefined,
  '',
  ` ${URI}`,
  `${URI}\n`,
  'https://example.com/?uri=' + encodeURIComponent(URI),
  'pali://other?uri=' + encodeURIComponent(URI),
  'pali://wc/path?uri=' + encodeURIComponent(URI),
  'pali://user@wc?uri=' + encodeURIComponent(URI),
  link() + '&redirect=https://example.com',
  link() + '&uri=' + encodeURIComponent(URI),
  link() + '#fragment',
  link(link()),
  link('javascript:alert(1)'),
  'wc:' + 'a'.repeat(4094),
  'pali://wc?uri=%00wc:abc',
]) {
  test('rejects an unrelated, ambiguous or oversized routing input', () => {
    assert.equal(extractPairingUri(value), null);
  });
}

test('a pending link is not replaced, consumed by another ID, or duplicated after delivery', () => {
  const inbox = new NativePairingInbox();
  try {
    const first = inbox.offer(link());
    assert.ok(first);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(inbox.offer(URI), undefined);
    assert.equal(inbox.offer(link(URI.replace('ab', 'ef'))), undefined);
    inbox.consume('old-id');
    assert.equal(inbox.getSnapshot(), first);
    inbox.consume(first.id);
    assert.equal(inbox.getSnapshot(), null);
    assert.equal(inbox.offer(link()), undefined);
    assert.ok(inbox.offer(link(URI.replace('ab', 'ef'))));
  } finally {
    inbox.dispose();
  }
});

test('expired input can be replaced without an old consumer removing the new entry', () => {
  let now = 1000;
  const inbox = new NativePairingInbox(() => now);
  try {
    const first = inbox.offer(URI)!;
    now = first.expiresAt;
    const next = inbox.offer(URI)!;
    assert.notEqual(next.id, first.id);
    inbox.consume(first.id);
    assert.equal(inbox.getSnapshot(), next);
  } finally {
    inbox.dispose();
  }
});

test('disposing the ephemeral inbox clears input and prevents later offers', () => {
  const inbox = new NativePairingInbox();
  inbox.offer(URI);
  inbox.dispose();
  assert.equal(inbox.getSnapshot(), null);
  assert.equal(inbox.offer(URI), undefined);
});

function links() {
  let finish!: (value: string | null) => void;
  let listener!: (event: { url: string }) => void;
  let removed = false;
  return {
    source: {
      getInitialURL: () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        }),
      addEventListener(_name: 'url', callback: typeof listener) {
        listener = callback;
        return {
          remove() {
            removed = true;
          },
        };
      },
    },
    initial: (value: string | null) => finish(value),
    warm: (url: string) => listener({ url }),
    removed: () => removed,
  };
}

test('a warm URL supersedes the delayed cold URL and cleanup detaches delivery', async () => {
  const input = links(),
    received: string[] = [];
  const close = observePairingLinks(
    input.source,
    (value) => received.push(value),
    () => true
  );
  input.warm('newer');
  input.initial('older');
  await settle();
  assert.deepEqual(received, ['newer']);
  close();
  input.warm('after-close');
  assert.deepEqual(received, ['newer']);
  assert.equal(input.removed(), true);
});

test('user navigation and unmount both suppress late initial routing', async () => {
  for (const unmount of [false, true]) {
    const input = links(),
      received: string[] = [];
    let current = true;
    const close = observePairingLinks(
      input.source,
      (value) => received.push(value),
      () => current
    );
    if (unmount) close();
    else current = false;
    input.initial(link());
    await settle();
    assert.deepEqual(received, []);
    close();
  }
});

test('a current cold URL is delivered once through the same receiver as warm links', async () => {
  const input = links(),
    received: string[] = [];
  const close = observePairingLinks(
    input.source,
    (value) => received.push(value),
    () => true
  );
  input.initial(link());
  await settle();
  assert.deepEqual(received, [link()]);
  close();
});

test('the expiry timer releases pending input without another incoming event', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const inbox = new NativePairingInbox();
  try {
    inbox.offer(URI);
    t.mock.timers.tick(5 * 60_000);
    assert.equal(inbox.getSnapshot(), null);
  } finally {
    inbox.dispose();
  }
});

test('an unavailable initial-link bridge leaves the warm-link listener usable', async () => {
  const input = links(),
    received: string[] = [];
  const close = observePairingLinks(
    {
      ...input.source,
      getInitialURL() {
        throw Error('Bridge unavailable');
      },
    },
    (value) => received.push(value),
    () => true
  );
  await settle();
  input.warm(link());
  assert.deepEqual(received, [link()]);
  close();
});

test('routing extraction works without String.isWellFormed and rejects non-ASCII URI input', () => {
  const module = {
    exports: {} as { extractPairingUri(value: unknown): string | null },
  };
  const source = readFileSync(
    new URL('../src/connections/pairingLinks.ts', import.meta.url),
    'utf8'
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  runInNewContext('delete String.prototype.isWellFormed;\n' + code, {
    module,
    exports: module.exports,
    URL,
    setTimeout,
    clearTimeout,
  });
  assert.equal(module.exports.extractPairingUri(link()), URI);
  assert.equal(module.exports.extractPairingUri(URI + 'é'), null);
});

test('recent-topic deduplication does not need to retain the pairing secret', () => {
  const inbox = new NativePairingInbox();
  try {
    const first = inbox.offer(URI)!;
    inbox.consume(first.id);
    assert.equal(
      inbox.offer(URI.replace('cd'.repeat(32), 'ef'.repeat(32))),
      undefined
    );
    assert.equal(inbox.getSnapshot(), null);
  } finally {
    inbox.dispose();
  }
});
