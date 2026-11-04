import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_SELECTION_KEY, PUBLIC_ACCOUNTS_KEY, createPublicAccountStorage } from '../src/core/publicAccountStorage.ts';
import { createEvmWatchAccount } from '../src/core/watchOnlyAuthority.ts';

const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const OTHER = '0x1111111111111111111111111111111111111111';
const first = createEvmWatchAccount('watch_1', 'First', ADDRESS);
const second = createEvmWatchAccount('watch_2', 'Second', OTHER);
const encode = (accounts: readonly unknown[]) => JSON.stringify({ version: 1, accounts });
function fixture(raw: string | null = encode([first])) {
  const data: Record<string, string> = raw === null ? {} : { [PUBLIC_ACCOUNTS_KEY]: raw };
  const writes: { key: string; value: string }[] = [];
  const repository = createPublicAccountStorage({
    async get(key) { return data[key] ?? null; },
    async set(key, value) { writes.push({ key, value }); data[key] = value; },
  });
  return { data, writes, repository };
}

test('public repository preserves the v1 record format and explicit legacy network mappings', async () => {
  const legacy = { id: 'old', name: 'Original', addresses: { ethereum: ADDRESS } };
  const f = fixture(encode([legacy]));
  assert.deepEqual(await f.repository.loadAccounts(), [legacy]);
  await f.repository.compareAndSetAccounts([legacy], [legacy, second]);
  assert.deepEqual(JSON.parse(f.data[PUBLIC_ACCOUNTS_KEY]!), { version: 1, accounts: [legacy, second] });
  assert.deepEqual(Object.keys((await f.repository.loadAccounts())[0]!.addresses), ['ethereum']);
  assert.deepEqual(Object.keys(f.data), [PUBLIC_ACCOUNTS_KEY]);
});

test('only absent public records are empty; invalid saved records cannot be overwritten', async () => {
  assert.deepEqual(await fixture(null).repository.loadAccounts(), []);
  for (const raw of ['not json', 'null', '[]', JSON.stringify({ version: 2, accounts: [] }),
    JSON.stringify({ version: 1, accounts: [], keyring: {} }), encode([{ ...first, privateKey: 'bad' }]),
    JSON.stringify({ version: 1, accounts: [{ ...first, addresses: { bitcoin: ADDRESS } }] }), ' '.repeat(32769)]) {
    const f = fixture(raw);
    await assert.rejects(f.repository.loadAccounts());
    await assert.rejects(f.repository.compareAndSetAccounts([], [second]));
    assert.equal(f.data[PUBLIC_ACCOUNTS_KEY], raw);
    assert.equal(f.writes.length, 0);
  }
});

test('a stale compare-and-set never overwrites independently changed public data', async () => {
  const f = fixture();
  const loaded = await f.repository.loadAccounts();
  f.data[PUBLIC_ACCOUNTS_KEY] = encode([second]);
  await assert.rejects(f.repository.compareAndSetAccounts(loaded, [first, second]), /changed/);
  assert.equal(f.data[PUBLIC_ACCOUNTS_KEY], encode([second]));
  assert.equal(f.writes.length, 0);
});

test('serialized competing saves re-read before committing the second stale snapshot', async () => {
  const f = fixture();
  const firstSave = f.repository.compareAndSetAccounts([first], [first, second]);
  const staleSave = f.repository.compareAndSetAccounts([first], []);
  await firstSave;
  await assert.rejects(staleSave, /changed/);
  assert.equal(f.data[PUBLIC_ACCOUNTS_KEY], encode([first, second]));
  assert.equal(f.writes.length, 1);
});

test('an acknowledged but missing or wrong write fails readback verification', async () => {
  for (const kind of ['ignored', 'different', 'throw'] as const) {
    let raw = encode([first]);
    let written = false;
    const repository = createPublicAccountStorage({
      async get() { if (written && kind === 'throw') throw Error('readback failed'); return raw; },
      async set() { written = true; if (kind === 'different') raw = encode([]); },
    });
    await assert.rejects(repository.compareAndSetAccounts([first], [second]));
    assert.equal(raw, kind === 'different' ? encode([]) : encode([first]));
  }
});

test('selection storage is separate bounded advisory data; corruption is preserved on save', async () => {
  const f = fixture();
  await f.repository.saveSelection({ kind: 'hd', id: 'hd:60:1' });
  assert.deepEqual(await f.repository.loadSelection(), { kind: 'hd', id: 'hd:60:1' });
  assert.equal(f.data[PUBLIC_ACCOUNTS_KEY], encode([first]));
  await f.repository.saveSelection(null);
  assert.equal(await f.repository.loadSelection(), null);
  for (const raw of ['not json', JSON.stringify({ kind: 'watch', id: 'x'.repeat(257) }), JSON.stringify({ kind: 'hd', id: 'hd:60:0', unlocked: true })]) {
    f.data[ACCOUNT_SELECTION_KEY] = raw;
    const writes = f.writes.length;
    await assert.rejects(f.repository.loadSelection());
    await assert.rejects(f.repository.saveSelection({ kind: 'watch', id: first.id }));
    assert.equal(f.data[ACCOUNT_SELECTION_KEY], raw);
    assert.equal(f.writes.length, writes);
  }
});

test('a selection write that is not persisted fails visibly without touching public accounts', async () => {
  const repository = createPublicAccountStorage({ get: async (key) => key === PUBLIC_ACCOUNTS_KEY ? encode([first]) : null, set: async () => undefined });
  await assert.rejects(repository.saveSelection({ kind: 'watch', id: first.id }), /could not be verified/);
  assert.deepEqual(await repository.loadAccounts(), [first]);
});
