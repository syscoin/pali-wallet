import assert from 'node:assert/strict';
import test from 'node:test';
import { SoftwareKeyring, createKeyringHost } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { previewNativePhraseAddresses } from '../src/custody/phrasePreview.ts';
import { getUtxoNetwork, UTXO_NETWORKS, supportsUtxoSoftwareCustody } from '../src/core/utxoNetworks.ts';

// Public zero-entropy mnemonic vectors only. Never use these accounts for funds.
const PHRASE = Array(11).fill('abandon').concat('about').join(' ');
const EVM = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const BTC = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const SYS = 'sys1q2fs58xaj4tp7qrr3slpdsm65j3nw030d246lmx';
const current = () => undefined;

function fixture() {
  let armed = false;
  const accesses: string[] = [];
  const access = (operation: string) => {
    if (armed) { accesses.push(operation); throw Error('Preview must not touch wallet storage'); }
  };
  const keyring = new SoftwareKeyring(createKeyringHost({
    async get(key) { access(`get:${key}`); return undefined; },
    async set(key) { access(`set:${key}`); },
    async deleteItem(key) { access(`delete:${key}`); },
    async createManyIfAbsent() { access('create'); return false; },
  }), { captureEvmSubmission: null });
  // Constructor diagnostics are outside the preview; no session is initialized.
  armed = true;
  return { keyring, accesses, async close() { armed = false; await keyring.destroy(); } };
}

test('actual SDK previews known EVM, Bitcoin and Syscoin addresses without opening storage or a session', async () => {
  const f = fixture();
  try {
    assert.equal(f.keyring.isUnlocked(), false);
    for (const [id, expected] of [['bitcoin', BTC], ['syscoin', SYS]] as const) {
      const network = getUtxoNetwork(id);
      const rows = await previewNativePhraseAddresses(f.keyring, PHRASE, network, current);
      assert.deepEqual(rows, [{ label: 'EVM account', address: EVM }, { label: `${network.name} UTXO`, address: expected }]);
      assert.equal(Object.isFrozen(rows), true);
      for (const row of rows) {
        assert.equal(Object.isFrozen(row), true);
        assert.deepEqual(Object.keys(row).sort(), ['address', 'label']);
      }
      assert.equal(JSON.stringify(rows).includes(PHRASE), false);
    }
    assert.deepEqual(await previewNativePhraseAddresses(f.keyring, PHRASE, undefined, current), [{ label: 'EVM account', address: EVM }]);
    assert.equal(f.keyring.isUnlocked(), false);
    assert.deepEqual(f.accesses, []);
  } finally { await f.close(); }
});

test('the configured first supported default supplies exactly one UTXO preview row', async () => {
  const f = fixture();
  try {
    const network = UTXO_NETWORKS.find(network => supportsUtxoSoftwareCustody(network)); assert(network);
    const rows = await previewNativePhraseAddresses(f.keyring, PHRASE, network, current);
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.label, `${network.name} UTXO`);
    assert.deepEqual(f.accesses, []);
  } finally { await f.close(); }
});

test('malformed, noncanonical and checksum-invalid phrases never reach address derivation', async () => {
  const f = fixture(); let derived = 0;
  const keyring = { isSeedValid: f.keyring.isSeedValid, importWeb3Account(phrase: string) { derived++; return f.keyring.importWeb3Account(phrase); } };
  try {
    for (const phrase of ['', Array(11).fill('abandon').join(' '), Array(13).fill('abandon').join(' '),
      Array(12).fill('abandon').join(' '), ` ${PHRASE}`, PHRASE.replace(' ', '  '), PHRASE.replace(' ', '\n'),
      PHRASE.toUpperCase(), 'a'.repeat(4097), '\ud800']) {
      await assert.rejects(previewNativePhraseAddresses(keyring, phrase, undefined, current), /^Error: INVALID_INPUT$/);
    }
    assert.equal(derived, 0); assert.deepEqual(f.accesses, []);
  } finally { await f.close(); }
});

for (const phase of ['before', 'validation', 'derivation', 'utxo-import'] as const) {
  test(`cancellation at ${phase} prevents publication of a public preview`, async () => {
    const f = fixture(); let active = phase !== 'before'; let derived = 0;
    const guard = () => { if (!active) throw Error('CANCELLED'); };
    const keyring = {
      isSeedValid(phrase: string) { const valid = f.keyring.isSeedValid(phrase); if (phase === 'validation') active = false; return valid; },
      importWeb3Account(phrase: string) { derived++; const account = f.keyring.importWeb3Account(phrase); if (phase === 'derivation') active = false; return account; },
    };
    try {
      const pending = previewNativePhraseAddresses(keyring, PHRASE, phase === 'utxo-import' ? getUtxoNetwork('syscoin') : undefined, guard);
      if (phase === 'utxo-import') active = false;
      await assert.rejects(pending, /^Error: CANCELLED$/);
      assert.equal(derived, phase === 'before' || phase === 'validation' ? 0 : 1);
      assert.deepEqual(f.accesses, []);
    } finally { await f.close(); }
  });
}

test('an asynchronous guard cannot grant preview authority', async () => {
  const f = fixture(); let validations = 0;
  try {
    await assert.rejects(previewNativePhraseAddresses({ isSeedValid() { validations++; return true; }, importWeb3Account: f.keyring.importWeb3Account }, PHRASE,
      undefined, (() => Promise.reject(Error('not current'))) as unknown as () => void), /^Error: CANCELLED$/);
    assert.equal(validations, 0);
    await new Promise(resolve => setImmediate(resolve));
  } finally { await f.close(); }
});

test('unregistered network copies and SDK failures disclose no phrase or private return fields', async () => {
  const f = fixture();
  try {
    const forged = { ...getUtxoNetwork('syscoin') };
    await assert.rejects(previewNativePhraseAddresses(f.keyring, PHRASE, forged, current), /^Error: UNAVAILABLE$/);
    await assert.rejects(previewNativePhraseAddresses({ isSeedValid: f.keyring.isSeedValid,
      importWeb3Account() { throw Error(`private: ${PHRASE}`); } }, PHRASE, undefined, current), /^Error: UNAVAILABLE$/);
    assert.deepEqual(f.accesses, []);
  } finally { await f.close(); }
});
