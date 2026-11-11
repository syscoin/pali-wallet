import { Interface } from 'ethers/abi';
import { getAddress } from 'ethers/address';
import { parseErc20Units, type Erc20Metadata } from '../../../../source/shared/erc20.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { snapshotNativeNetwork } from '../custody/networkContext.ts';
import type { NativeNotificationScope } from '../notifications/types.ts';
import { createErc20Reader, createSelectedNftReadOperation } from './erc20ReadRpc.ts';
import { createNftOwnershipReader } from './nftOwnershipReadRpc.ts';
import { MAX_NATIVE_TOKENS, snapshotSavedCollectible, type NativeTokenInventory, type NativeTokenPortfolioScope, type SavedCollectible } from './tokenRegistry.ts';
import { parseErc20Metadata } from './erc20Metadata.ts';

export type PortfolioAssetSnapshot = Readonly<{
  tokens: readonly Readonly<{ metadata: Erc20Metadata; status: 'available' | 'error'; units: string | null }>[];
  collectibles: readonly Readonly<{ collectible: SavedCollectible; status: 'available' | 'error'; units: string | null }>[];
}>;
const collectionInterface = new Interface([
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]);
const empty = (): PortfolioAssetSnapshot => Object.freeze({ tokens: Object.freeze([]), collectibles: Object.freeze([]) });

/** Read only saved metadata for one visible, selected-account scope. The host
 * admits the exact scope before storage and before every existing RPC read.
 */
export function createScopedPortfolioAssetReader(ports: {
  load(scope: NativeTokenPortfolioScope, assertCurrent: () => void): Promise<NativeTokenInventory>;
  fetch(url: string, init: RequestInit): Promise<Response>;
}) {
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
    if (!input?.network || !('kind' in input.network) || input.network.kind !== 'evm') return empty();
    const scope = Object.freeze({ accountId: input.accountId, accountAddress: getAddress(input.accountAddress) });
    const network = snapshotNativeNetwork(input.network);
    const inventory = await ports.load(Object.freeze({ accountId: scope.accountId,
      address: scope.accountAddress, networkId: network.id, registrationHash: network.registrationHash }), check);
    check();
    if (!Array.isArray(inventory.items) || !Array.isArray(inventory.collectibles ?? []) ||
        inventory.items.length + (inventory.collectibles?.length ?? 0) > MAX_NATIVE_TOKENS)
      throw new Error('Invalid saved portfolio assets');
    const metadata = inventory.items.map(parseErc20Metadata);
    const collectibles = (inventory.collectibles ?? []).map(snapshotSavedCollectible);
    const options = {
      registrations: () => { check(); return [network]; },
      fetch: async (url: string, init: RequestInit) => {
        check();
        if (url !== network.rpcUrl) throw new Error('Portfolio endpoint changed');
        const response = await ports.fetch(url, init);
        check();
        return response;
      },
    };
    const erc20 = createErc20Reader(options);
    const ownership = createNftOwnershipReader(options);
    const collection = createSelectedNftReadOperation(options);
    const work: (() => Promise<void>)[] = [];
    const tokenRows: PortfolioAssetSnapshot['tokens'][number][] = new Array(metadata.length);
    const collectibleRows: PortfolioAssetSnapshot['collectibles'][number][] = new Array(collectibles.length);
    for (const [index, token] of metadata.entries()) work.push(async () => {
      check();
      try {
        const result = await erc20.readBalance(network.id, scope.accountAddress, token, signal);
        check();
        tokenRows[index] = Object.freeze({ metadata: token, status: 'available', units: parseErc20Units(result.units) });
      } catch {
        check();
        tokenRows[index] = Object.freeze({ metadata: token, status: 'error', units: null });
      }
    });
    for (const [index, saved] of collectibles.entries()) work.push(async () => {
      check();
      try {
        const units = saved.tokenStandard === 'ERC-1155'
          ? (await ownership({ networkId: network.id, owner: scope.accountAddress, ...saved }, signal, check)).units
          : await collection(network.id, scope.accountAddress, saved.contractAddress, signal, check,
            async ({ holder, call }) => {
              const supported = await call(collectionInterface.encodeFunctionData('supportsInterface', ['0x80ac58cd']));
              if (supported.kind !== 'result' || supported.data !== `0x${'0'.repeat(63)}1`)
                throw new Error('Saved collection support unavailable');
              const balance = await call(collectionInterface.encodeFunctionData('balanceOf', [holder]));
              if (balance.kind !== 'result' || !/^0x[0-9a-fA-F]{64}$/.test(balance.data))
                throw new Error('Saved collection balance unavailable');
              return parseErc20Units(BigInt(balance.data));
            });
        check();
        collectibleRows[index] = Object.freeze({ collectible: saved, status: 'available', units: parseErc20Units(units) });
      } catch {
        check();
        collectibleRows[index] = Object.freeze({ collectible: saved, status: 'error', units: null });
      }
    });
    // Bound transport concurrency; each reader retains its own anchored block.
    for (let offset = 0; offset < work.length; offset += 4) {
      check();
      await Promise.all(work.slice(offset, offset + 4).map(read => read()));
    }
    check();
    return Object.freeze({ tokens: Object.freeze(tokenRows), collectibles: Object.freeze(collectibleRows) });
  };
}
