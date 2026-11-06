import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface } from 'ethers/abi';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import {
  EvmSignedRecords,
  type EvmRetainedSignedRecord,
} from '../../../source/wallet/evmSignedRecords.ts';
import {
  EvmSignedReplay,
  projectSavedEvmTransaction,
} from '../../../source/wallet/evmSignedReplay.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { createNativeSignedRecordView } from '../src/custody/sharedSignedRecords.ts';
import { signedRecordTestSession } from './signedRecordTestSession.ts';

const wallet = new Wallet(`0x${'11'.repeat(32)}`);
const recipient = `0x${'22'.repeat(20)}`;
const contractAddress = `0x${'33'.repeat(20)}`;
const max = (1n << 256n) - 1n;
const standard = new Interface([
  'function transferFrom(address,address,uint256)',
  'function safeTransferFrom(address,address,uint256,uint256,bytes)',
]);
const erc721 = (owner = wallet.address, tokenId = 0n) =>
  standard.encodeFunctionData('transferFrom', [owner, recipient, tokenId]);
const erc1155 = (amount = max, bytes = '0x') =>
  standard.encodeFunctionData('safeTransferFrom', [
    wallet.address,
    recipient,
    max,
    amount,
    bytes,
  ]);
const send = {
  to: contractAddress,
  type: 0,
  gasLimit: 150000n,
  gasPrice: 1n,
  nonce: 0,
  chainId: 1n,
  value: 0n,
};
const context = {
  account: { id: 0, type: 'HDAccount' as const, address: wallet.address },
  network: {
    kind: 'ethereum' as const,
    chainId: 1,
    slip44: 60,
    url: 'https://offline.invalid',
  },
};
const signer = { id: 0, type: 'HDAccount' };

async function sign(
  operation: EvmRetainedSignedRecord['operation'],
  data: string,
  overrides: Partial<typeof send> = {}
): Promise<EvmRetainedSignedRecord> {
  const rawTransaction = await wallet.signTransaction({
    ...send,
    ...overrides,
    data,
  });
  const tx = Transaction.from(rawTransaction);
  return {
    rawTransaction,
    chainId: tx.chainId.toString(),
    createdAt: 1,
    from: tx.from!.toLowerCase(),
    hash: tx.hash!,
    nonce: tx.nonce,
    operation,
    phase: 'signed',
    signer,
  };
}

const expected = (
  tokenStandard: 'ERC-721' | 'ERC-1155',
  tokenId: bigint,
  amount: bigint
) => ({
  kind: 'nft-transfer',
  chainId: '1',
  from: wallet.address,
  recipient,
  contractAddress,
  tokenStandard,
  tokenId: tokenId.toString(),
  amountUnits: amount.toString(),
});

test('both detail adapters inspect authenticated NFT records without stored metadata or a replay admission', async () => {
  let stored: string | undefined;
  const records = new EvmSignedRecords(
    {
      async read() {
        return stored;
      },
      async compareAndSet(_profile, before, next, assertCurrent) {
        assertCurrent();
        if (stored !== before) return false;
        stored = next;
        return true;
      },
    },
    () => 1
  );
  const session = signedRecordTestSession(() => undefined);
  const legacy = await sign('erc721', erc721());
  const feeMarket = await sign('erc1155', erc1155(), { type: 2, nonce: 1 });
  for (const entry of [legacy, feeMarket]) {
    await records.append(session, {
      ...entry,
      type: Transaction.from(entry.rawTransaction).type,
      context: { ...context, operation: entry.operation },
    });
  }
  const replay = new EvmSignedReplay(records, () => ({
    recordSession: session,
    context,
    assertCurrent: session.assertCurrent,
    async observe() {
      throw Error('Inspection must not observe');
    },
    async dispatch() {
      throw Error('Inspection must not dispatch');
    },
  }));
  const native = createNativeSignedRecordView(
    records,
    session,
    'a'.repeat(64),
    { index: 0, type: 'HDAccount', address: wallet.address },
    getNativeNetwork('ethereum')
  );
  const activities = await native.activities();
  for (const [entry, intent] of [
    [legacy, expected('ERC-721', 0n, 1n)],
    [feeMarket, expected('ERC-1155', max, max)],
  ] as const) {
    const inspected = await replay.get(entry.hash);
    assert.deepEqual(inspected?.collectibleTransfer, intent);
    assert.equal(inspected?.to, contractAddress);
    assert.equal(inspected?.value, '0');
    assert.equal(Object.hasOwn(inspected!, 'rawTransaction'), false);
    const activity = activities.records.find((row) => row.hash === entry.hash);
    assert.deepEqual(activity?.collectibleTransfer, intent);
    assert.equal(activity?.recipient, contractAddress);
    assert.equal(activity?.inspectionOnly, true);
  }
  assert.deepEqual(
    projectSavedEvmTransaction(
      await sign('erc721', erc721(wallet.address, max))
    ).collectibleTransfer,
    expected('ERC-721', max, 1n)
  );
  // The authenticated manifest covers the typed operation, not only the bytes.
  stored = stored!.replace('"operation":"erc721"', '"operation":"erc20"');
  await assert.rejects(replay.get(legacy.hash), {
    message: 'EVM_SIGNED_RECORD_CORRUPT',
  });
});

test('NFT semantics refuse other operations, mismatched context, and malformed signed calls', async () => {
  const valid = await sign('erc721', erc721());
  const differentTarget = await sign('erc721', erc721(), { to: recipient });
  const unsigned = Transaction.from({
    ...send,
    data: erc721(),
  }).unsignedSerialized;
  const rejected = [
    { ...valid, operation: 'send' as const },
    { ...valid, operation: 'erc20' as const },
    { ...valid, operation: 'erc1155' as const },
    { ...valid, chainId: '2' },
    { ...valid, from: recipient },
    { ...valid, nonce: 1 },
    { ...valid, rawTransaction: differentTarget.rawTransaction },
    { ...valid, rawTransaction: unsigned },
    await sign('erc721', erc721(recipient)),
    await sign('erc721', erc721(), { value: 1n }),
    await sign('erc721', erc721() + '00'.repeat(32)),
    await sign('erc721', erc721().slice(0, -2)),
    await sign('erc721', `0x${'00'.repeat(4)}${erc721().slice(10)}`),
    await sign('erc721', `0x${erc721().slice(2, 10)}01${erc721().slice(12)}`),
    await sign('erc1155', erc721()),
    await sign('erc721', erc1155()),
    await sign('erc1155', erc1155(0n)),
    await sign('erc1155', erc1155(1n, '0x01')),
    await sign('erc1155', erc1155(1n) + '00'.repeat(32)),
  ];
  for (const entry of rejected) {
    const summary = projectSavedEvmTransaction(entry);
    assert.equal(summary.collectibleTransfer, undefined);
  }
});
