import { Interface } from 'ethers/abi';
import { getAddress } from 'ethers/address';
import {
  parseErc20Units,
  type Erc20Metadata,
} from '../../../../source/shared/erc20.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { snapshotNativeNetwork } from '../custody/networkContext.ts';
import type { NativeNotificationScope } from '../notifications/types.ts';
import {
  createErc20Reader,
  createSelectedNftPortfolioReadOperation,
} from './erc20ReadRpc.ts';
import {
  normalizeNftExecutionRevert,
  verifyERC1155OwnershipHelper,
} from '../../../../source/shared/nftReads.ts';
import {
  MAX_NATIVE_TOKENS,
  snapshotSavedCollectible,
  type NativeTokenInventory,
  type NativeTokenPortfolioScope,
  type SavedCollectible,
} from './tokenRegistry.ts';
import { parseErc20Metadata } from './erc20Metadata.ts';

export type PortfolioAssetSnapshot = Readonly<{
  tokens: readonly Readonly<{
    metadata: Erc20Metadata;
    status: 'available' | 'error';
    units: string | null;
  }>[];
  collectibles: readonly Readonly<{
    collectible: SavedCollectible;
    status: 'available' | 'error';
    units: string | null;
  }>[];
}>;
const collectionInterface = new Interface([
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]);
const empty = (): PortfolioAssetSnapshot =>
  Object.freeze({ tokens: Object.freeze([]), collectibles: Object.freeze([]) });

/** Read only saved metadata for one visible, selected-account scope. The host
 * admits the exact scope before storage and before every existing RPC read.
 */
export function createScopedPortfolioAssetReader(ports: {
  load(
    scope: NativeTokenPortfolioScope,
    assertCurrent: () => void
  ): Promise<NativeTokenInventory>;
  fetch(url: string, init: RequestInit): Promise<Response>;
}) {
  const registrations = new Map<
    string,
    ReturnType<typeof snapshotNativeNetwork>
  >();
  const erc20 = createErc20Reader({
    fetch: ports.fetch,
    registrations: () => [...registrations.values()],
  });
  const nft = createSelectedNftPortfolioReadOperation({
    fetch: ports.fetch,
    registrations: () => [...registrations.values()],
  });
  return async (
    input: NativeNotificationScope,
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<PortfolioAssetSnapshot> => {
    const check = () => {
      if (signal.aborted) throw new Error('Portfolio scope changed');
      assertSynchronousEvmFeeGuard(assertCurrent);
    };
    check();
    // UTXO tokens remain on the existing account-summary path.
    if (
      !input?.network ||
      !('kind' in input.network) ||
      input.network.kind !== 'evm'
    )
      return empty();
    const scope = Object.freeze({
      accountId: input.accountId,
      accountAddress: getAddress(input.accountAddress),
    });
    const network = snapshotNativeNetwork(input.network);
    registrations.set(network.id, network);
    if (registrations.size > 32)
      registrations.delete(registrations.keys().next().value!);
    const inventory = await ports.load(
      Object.freeze({
        accountId: scope.accountId,
        address: scope.accountAddress,
        networkId: network.id,
        registrationHash: network.registrationHash,
      }),
      check
    );
    check();
    if (
      !Array.isArray(inventory.items) ||
      !Array.isArray(inventory.collectibles ?? []) ||
      inventory.items.length + (inventory.collectibles?.length ?? 0) >
        MAX_NATIVE_TOKENS
    )
      throw new Error('Invalid saved portfolio assets');
    const metadata = inventory.items.map(parseErc20Metadata);
    const collectibles = (inventory.collectibles ?? []).map(
      snapshotSavedCollectible
    );
    const work: (() => Promise<void>)[] = [];
    const tokenRows: PortfolioAssetSnapshot['tokens'][number][] = new Array(
      metadata.length
    );
    const collectibleRows: PortfolioAssetSnapshot['collectibles'][number][] =
      new Array(collectibles.length);
    if (metadata.length)
      work.push(async () => {
        check();
        try {
          const results = await erc20.readBalances!(
            network.id,
            scope.accountAddress,
            metadata,
            signal,
            check
          );
          check();
          for (const [index, token] of metadata.entries()) {
            const result = results[index]!;
            tokenRows[index] = Object.freeze({
              metadata: token,
              status: result.status,
              units: result.units,
            });
          }
        } catch {
          check();
          for (const [index, token] of metadata.entries())
            tokenRows[index] = Object.freeze({
              metadata: token,
              status: 'error',
              units: null,
            });
        }
      });
    if (collectibles.length)
      work.push(async () => {
        check();
        try {
          await nft(
            network.id,
            scope.accountAddress,
            collectibles.map((saved) => saved.contractAddress),
            signal,
            check,
            async ({ holder, withContract }) => {
              const groups = new Map<
                string,
                { saved: SavedCollectible; index: number }[]
              >();
              for (const [index, saved] of collectibles.entries()) {
                const key = `${saved.contractAddress}:${saved.tokenStandard}`;
                const group = groups.get(key) ?? [];
                group.push({ saved, index });
                groups.set(key, group);
              }
              const readGroup = async (
                group: { saved: SavedCollectible; index: number }[]
              ) => {
                const first = group[0]!.saved;
                try {
                  await withContract(first.contractAddress, async (call) => {
                    if (first.tokenStandard === 'ERC-1155') {
                      const holdings = await verifyERC1155OwnershipHelper(
                        first.contractAddress,
                        holder,
                        group.map((row) => {
                          if (row.saved.tokenStandard !== 'ERC-1155')
                            throw new Error(
                              'Saved collectible standard changed'
                            );
                          return row.saved.tokenId;
                        }),
                        {
                          async call({ to, data }) {
                            if (
                              to !== first.contractAddress ||
                              typeof data !== 'string'
                            )
                              throw new Error(
                                'Saved collectible target changed'
                              );
                            const outcome = await call(data);
                            if (outcome.kind === 'result') return outcome.data;
                            throw (
                              normalizeNftExecutionRevert(outcome.error, {
                                to,
                                data,
                              }) ?? new Error('Saved balance unavailable')
                            );
                          },
                        }
                      );
                      check();
                      for (const [position, row] of group.entries()) {
                        const holding = holdings[position];
                        collectibleRows[row.index] = Object.freeze({
                          collectible: row.saved,
                          status: holding?.verified ? 'available' : 'error',
                          units:
                            holding?.verified &&
                            holding.rawBalance !== undefined
                              ? parseErc20Units(holding.rawBalance)
                              : null,
                        });
                      }
                    } else {
                      const [supported, balance] = await call.many([
                        collectionInterface.encodeFunctionData(
                          'supportsInterface',
                          ['0x80ac58cd']
                        ),
                        collectionInterface.encodeFunctionData('balanceOf', [
                          holder,
                        ]),
                      ]);
                      if (
                        !supported ||
                        supported.kind !== 'result' ||
                        supported.data !== `0x${'0'.repeat(63)}1`
                      )
                        throw new Error('Saved collection support unavailable');
                      if (
                        !balance ||
                        balance.kind !== 'result' ||
                        !/^0x[0-9a-fA-F]{64}$/.test(balance.data)
                      )
                        throw new Error('Saved collection balance unavailable');
                      check();
                      for (const row of group)
                        collectibleRows[row.index] = Object.freeze({
                          collectible: row.saved,
                          status: 'available',
                          units: parseErc20Units(BigInt(balance.data)),
                        });
                    }
                  });
                } catch {
                  check();
                  for (const row of group)
                    collectibleRows[row.index] = Object.freeze({
                      collectible: row.saved,
                      status: 'error',
                      units: null,
                    });
                }
              };
              const grouped = [...groups.values()];
              let next = 0;
              await Promise.all(
                Array.from(
                  { length: Math.min(4, grouped.length) },
                  async () => {
                    while (next < grouped.length)
                      await readGroup(grouped[next++]!);
                  }
                )
              );
            }
          );
        } catch {
          check();
          for (const [index, saved] of collectibles.entries())
            collectibleRows[index] = Object.freeze({
              collectible: saved,
              status: 'error',
              units: null,
            });
        }
      });
    // Bound transport concurrency; each reader retains its own anchored block.
    for (let offset = 0; offset < work.length; offset += 4) {
      check();
      await Promise.all(work.slice(offset, offset + 4).map((read) => read()));
    }
    check();
    return Object.freeze({
      tokens: Object.freeze(tokenRows),
      collectibles: Object.freeze(collectibleRows),
    });
  };
}
