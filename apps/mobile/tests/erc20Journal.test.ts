import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers/wallet';
import {
  NativeTransferJournal,
  terminalJournalForRemoval,
} from '../src/custody/transferJournal.ts';
import { encodeErc20Transfer } from '../../../source/shared/erc20.ts';
import { snapshotErc20TransferIntent } from '../src/custody/transferIntent.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';

const wallet = Wallet.fromPhrase(
  'test test test test test test test test test test test junk'
);
const scope = {
  walletFingerprint: '1'.repeat(64),
  address: wallet.address,
  chainId: '1',
};
const recipient = '0x1111111111111111111111111111111111111111';
const token = {
  contractAddress: '0x2222222222222222222222222222222222222222',
  name: 'Fixture token',
  symbol: 'FIX',
  decimals: 2,
};
const intent = snapshotErc20TransferIntent({
  kind: 'erc20-transfer',
  token,
  recipient,
  amountUnits: '123',
});
function storage() {
  const rows = new Map<string, unknown>();
  const port: KeyringStoragePort = {
    async get(key) {
      return structuredClone(rows.get(key));
    },
    async set(key, value) {
      rows.set(key, structuredClone(value));
    },
    async deleteItem(key) {
      rows.delete(key);
    },
    async createManyIfAbsent(values) {
      if (Object.keys(values).some((key) => rows.has(key))) return false;
      for (const [key, value] of Object.entries(values))
        rows.set(key, structuredClone(value));
      return true;
    },
    async compareAndSet(key, expected, value) {
      if (JSON.stringify(rows.get(key)) !== JSON.stringify(expected))
        return false;
      rows.set(key, structuredClone(value));
      return true;
    },
  };
  return { rows, port };
}
const signed = (
  nonce = 0,
  data = encodeErc20Transfer(recipient, '123'),
  value = 0n,
  to = token.contractAddress
) =>
  wallet.signTransaction({
    type: 2,
    chainId: 1,
    nonce,
    to,
    value,
    data,
    gasLimit: 60000,
    maxFeePerGas: 3,
    maxPriorityFeePerGas: 1,
  });
test('journal requires exact token intent for nonempty calldata and preserves it through transitions', async () => {
  const f = storage();
  const journal = new NativeTransferJournal(f.port, scope, () => undefined);
  const raw = await signed();
  assert.throws(() => journal.saveSigned(raw), /CORRUPT/);
  for (const change of [
    { amountUnits: '124' },
    { recipient: token.contractAddress },
    { token: { ...token, contractAddress: recipient } },
  ])
    assert.throws(
      () => journal.saveSigned(raw, { ...intent, ...change }),
      /CORRUPT/
    );
  for (const wrong of [
    await signed(0, encodeErc20Transfer(recipient, '123'), 1n),
    await signed(0, encodeErc20Transfer(recipient, '123') + '00'),
    await signed(0, '0x095ea7b3' + '00'.repeat(64)),
  ])
    assert.throws(() => journal.saveSigned(wrong, intent), /CORRUPT/);
  const entry = await journal.saveSigned(raw, intent);
  assert.deepEqual(entry.intent, intent);
  for (const phase of ['attempted', 'submitted', 'confirmed'] as const)
    assert.deepEqual(
      (await journal.transition(entry.hash, phase)).intent,
      intent
    );
  const persisted = f.rows.get('native-evm-transfer-v1') as any;
  assert.equal(persisted.version, 2);
  assert.deepEqual(persisted.entries[0].intent, intent);
  assert.doesNotThrow(() => terminalJournalForRemoval(persisted, scope));
  const native = await signed(1, '0x', 1n, recipient);
  assert.equal((await journal.saveSigned(native)).intent, undefined);
});
test('native and token transfers use one shared pending nonce slot', async () => {
  const f = storage();
  const journal = new NativeTransferJournal(f.port, scope, () => undefined);
  await journal.saveSigned(await signed(0, '0x', 1n, recipient));
  await assert.rejects(
    journal.saveSigned(await signed(1), intent),
    /PENDING_TRANSFER/
  );
  const other = storage();
  const tokenJournal = new NativeTransferJournal(
    other.port,
    scope,
    () => undefined
  );
  await tokenJournal.saveSigned(await signed(0), intent);
  await assert.rejects(
    tokenJournal.saveSigned(await signed(1, '0x', 1n, recipient)),
    /PENDING_TRANSFER/
  );
  assert.throws(
    () =>
      terminalJournalForRemoval(
        other.rows.get('native-evm-transfer-v1') as any,
        scope
      ),
    /PENDING_TRANSFER/
  );
});
test('malformed persisted token intent is preserved and cannot become native fallback', async () => {
  for (const mutation of [
    'missing-intent',
    'wrong-units',
    'wrong-token',
    'unknown-field',
  ]) {
    const f = storage();
    const journal = new NativeTransferJournal(f.port, scope, () => undefined);
    await journal.saveSigned(await signed(), intent);
    const row = f.rows.get('native-evm-transfer-v1') as any;
    if (mutation === 'missing-intent') delete row.entries[0].intent;
    if (mutation === 'wrong-units') row.entries[0].intent.amountUnits = '124';
    if (mutation === 'wrong-token')
      row.entries[0].intent.token.contractAddress = recipient;
    if (mutation === 'unknown-field') row.entries[0].intent.unknown = true;
    const before = structuredClone(row);
    await assert.rejects(journal.load(), /CORRUPT/);
    assert.deepEqual(f.rows.get('native-evm-transfer-v1'), before);
  }
});
