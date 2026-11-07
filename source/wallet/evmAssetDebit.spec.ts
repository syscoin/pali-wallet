/** @jest-environment node */
import {
  decryptPrivateRecordBytes,
  encryptPrivateRecordBytes,
  privateRecordProfileId,
} from '@sidhujag/sysweb3-keyring/cjs/private-records.js';
import { webcrypto } from 'crypto';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { encodeErc20Transfer } from '../shared/erc20';
import { encodeNftTransferData } from '../shared/nftTransfer';

import { EvmSignedRecords } from './evmSignedRecords';
import type { EvmSignedRecordSession } from './evmSignedRecords';
import type { EvmTransferAsset } from '../shared/evmAssetState';

const signer = new Wallet('0x' + '1'.padStart(64, '0'));
const target = '0x' + '2'.repeat(40),
  recipient = '0x' + '3'.repeat(40);
const asset: EvmTransferAsset = {
  standard: 'ERC20',
  contractAddress: target,
  amountUnits: '60',
};
function fixture() {
  const key = new Uint8Array(32).fill(42);
  const decrypt = jest.fn(
    (input: Parameters<typeof decryptPrivateRecordBytes>[1]) =>
      decryptPrivateRecordBytes(key, input, () => undefined)
  );
  const session: EvmSignedRecordSession = {
    assertCurrent: () => undefined,
    keyring: {
      getPrivateRecordProfileId: () =>
        privateRecordProfileId(key, () => undefined),
      encryptPrivateRecord: (input) =>
        encryptPrivateRecordBytes(key, input, () => undefined),
      decryptPrivateRecord: decrypt,
    },
  };
  let disk: string | undefined;
  const storage = {
    read: async () => disk,
    async compareAndSet(
      _profile: string,
      before: string | undefined,
      next: string,
      guard: () => void
    ) {
      guard();
      if (disk !== before) return false;
      disk = next;
      return true;
    },
  };
  const records = new EvmSignedRecords(storage);
  const append = async (
    data: string,
    operation: 'send' | 'erc20' | 'erc721' | 'erc1155' = 'send'
  ) => {
    const rawTransaction = await signer.signTransaction({
      chainId: 57,
      nonce: 0,
      type: 2,
      to: target,
      value: 0,
      data,
      gasLimit: 50000,
      maxFeePerGas: 3,
      maxPriorityFeePerGas: 1,
    });
    const tx = Transaction.from(rawTransaction);
    const entry = await records.append(session, {
      rawTransaction,
      hash: tx.hash!,
      from: signer.address,
      chainId: '57',
      nonce: 0,
      type: 2,
      context: {
        account: { id: 0, type: 'HDAccount', address: signer.address },
        network: {
          kind: 'ethereum',
          chainId: 57,
          slip44: 60,
          url: 'https://rpc.invalid',
        },
        operation,
      },
    });
    return {
      entry,
      decrypt,
      snapshot: await records.captureAutoNonceSnapshot(
        session,
        '57',
        signer.address
      ),
      async speedUp() {
        const binding = await records.captureVerifiedReplacement(session, {
          chainId: '57',
          from: signer.address,
          nonce: 0,
          originalHash: entry.hash,
          operation: 'speed-up',
        });
        const replacementBytes = await signer.signTransaction({
          chainId: 57,
          nonce: 0,
          type: 2,
          to: target,
          value: 0,
          data,
          gasLimit: 50000,
          maxFeePerGas: 6,
          maxPriorityFeePerGas: 2,
        });
        const replacementTx = Transaction.from(replacementBytes);
        const replacement = await records.append(
          session,
          {
            rawTransaction: replacementBytes,
            hash: replacementTx.hash!,
            from: signer.address,
            chainId: '57',
            nonce: 0,
            type: 2,
            context: {
              account: { id: 0, type: 'HDAccount', address: signer.address },
              network: {
                kind: 'ethereum',
                chainId: 57,
                slip44: 60,
                url: 'https://rpc.invalid',
              },
              operation: 'speed-up',
              originalHash: entry.hash,
            },
          },
          undefined,
          binding
        );
        return {
          replacement,
          snapshot: await records.captureAutoNonceSnapshot(
            session,
            '57',
            signer.address
          ),
        };
      },
    };
  };
  return { append };
}
beforeAll(() =>
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
);
it('decodes exact known ERC20 debit from authenticated bytes even for generic contract calls', async () => {
  const { entry, snapshot } = await fixture().append(
    encodeErc20Transfer(recipient, '30')
  );
  expect(await snapshot.readAssetDebit(entry.hash, asset)).toBe(BigInt(30));
  expect(
    await snapshot.readAssetDebit(entry.hash, {
      ...asset,
      contractAddress: recipient,
    })
  ).toBe(BigInt(0));
  await expect(
    snapshot.readAssetDebit('0x' + 'aa'.repeat(32), asset)
  ).rejects.toThrow('EVM_SIGNED_RECORD_NOT_FOUND');
});
it('keeps unknown calls distinct from malformed claimed token transfers', async () => {
  const generic = await fixture().append('0x12345678');
  expect(await generic.snapshot.readAssetDebit(generic.entry.hash, asset)).toBe(
    BigInt(0)
  );
  const claimed = await fixture().append('0x12345678', 'erc20');
  await expect(
    claimed.snapshot.readAssetDebit(claimed.entry.hash, asset)
  ).rejects.toThrow('EVM_SIGNED_RECORD_CORRUPT');
});
it.each(['ERC721', 'ERC1155'] as const)(
  'decodes %s by its calldata and exact token ID',
  async (standard) => {
    const nft = {
      standard,
      contractAddress: target,
      amountUnits: standard === 'ERC721' ? '1' : '4',
      tokenId: '7',
    };
    const data = encodeNftTransferData({
      kind: 'nft-transfer',
      chainId: '57',
      from: signer.address,
      recipient,
      contractAddress: target,
      tokenStandard: standard === 'ERC721' ? 'ERC-721' : 'ERC-1155',
      amountUnits: nft.amountUnits,
      tokenId: '7',
    });
    const { entry, snapshot } = await fixture().append(data);
    expect(await snapshot.readAssetDebit(entry.hash, nft)).toBe(
      BigInt(nft.amountUnits)
    );
    expect(
      await snapshot.readAssetDebit(entry.hash, { ...nft, tokenId: '8' })
    ).toBe(BigInt(0));
  }
);

it('reserves a speed-up through its authenticated calldata despite its replacement operation', async () => {
  const original = await fixture().append(
    encodeErc20Transfer(recipient, '30'),
    'erc20'
  );
  const { replacement, snapshot } = await original.speedUp();
  expect(await snapshot.readAssetDebit(original.entry.hash, asset)).toBe(
    BigInt(30)
  );
  expect(await snapshot.readAssetDebit(replacement.hash, asset)).toBe(
    BigInt(30)
  );
});

it('decrypts a predecessor once for repeated native-cost and asset-debit reads', async () => {
  const { entry, snapshot, decrypt } = await fixture().append(
    encodeErc20Transfer(recipient, '30')
  );
  decrypt.mockClear();
  expect(await snapshot.readMaximumCost(entry.hash)).toBe(BigInt(150000));
  expect(await snapshot.readAssetDebit(entry.hash, asset)).toBe(BigInt(30));
  expect(await snapshot.readAssetDebit(entry.hash, asset)).toBe(BigInt(30));
  expect(await snapshot.readMaximumCost(entry.hash)).toBe(BigInt(150000));
  expect(decrypt).toHaveBeenCalledTimes(1);
});
