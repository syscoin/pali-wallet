import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Wallet } from 'ethers/wallet';
import { encodeErc20Transfer } from '../../../source/shared/erc20.ts';
import { snapshotErc20TransferIntent } from '../src/custody/transferIntent.ts';
import {
  NativeTransferJournal,
  journalRequiresReopen,
} from '../src/custody/transferJournal.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  validPair,
  type SqlHook,
} from './storageHelpers.ts';

const wallet = Wallet.fromPhrase(
  'test test test test test test test test test test test junk'
);
const recipient = '0x1111111111111111111111111111111111111111';
const token = {
  contractAddress: '0x2222222222222222222222222222222222222222',
  name: 'Storage fixture',
  symbol: 'STORE',
  decimals: 255,
};
const intent = snapshotErc20TransferIntent({
  kind: 'erc20-transfer',
  chainId: '1',
  token,
  recipient,
  amountUnits: '1',
});
for (const point of ['before-commit', 'lost-ack'] as const)
  test(`ERC20 ${point} keeps durable intent and requires a fresh store`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pali-erc20-journal-'));
    const file = path.join(directory, 'wallet.sqlite');
    let enabled = false;
    const interrupt: SqlHook = (kind, sql) => {
      if (enabled && kind === 'exec' && sql === 'COMMIT') {
        enabled = false;
        throw Error('Simulated interruption');
      }
    };
    let storage = await SqliteWalletStorage.open(
      nodeConnection(
        file,
        point === 'before-commit' ? { before: interrupt } : { after: interrupt }
      ).connection,
      digest,
      INSTALLATION,
      true
    );
    try {
      await storage.keyringStorage.createManyIfAbsent(validPair());
      const scope = {
        walletFingerprint: await storage.getWalletFingerprint(),
        address: wallet.address,
        chainId: '1',
      };
      const journal = new NativeTransferJournal(
        storage.keyringStorage,
        scope,
        () => undefined
      );
      const raw = await wallet.signTransaction({
        type: 2,
        chainId: 1,
        nonce: 0,
        to: token.contractAddress,
        value: 0,
        data: encodeErc20Transfer(recipient, '1'),
        gasLimit: 60000,
        maxFeePerGas: 3,
        maxPriorityFeePerGas: 1,
      });
      enabled = true;
      await assert.rejects(journal.saveSigned(raw, intent), /REOPEN_REQUIRED/);
      assert.equal(journalRequiresReopen(storage.keyringStorage), true);
      await assert.rejects(journal.load(), /REOPEN_REQUIRED/);
      await storage.close().catch(() => undefined);
      storage = await SqliteWalletStorage.open(
        nodeConnection(file).connection,
        digest,
        INSTALLATION,
        false
      );
      const restored = await new NativeTransferJournal(
        storage.keyringStorage,
        scope,
        () => undefined
      ).load();
      if (point === 'before-commit') assert.equal(restored, null);
      else {
        assert.equal(restored!.rawTransaction, raw);
        assert.deepEqual(restored!.intent, intent);
      }
    } finally {
      await storage.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
