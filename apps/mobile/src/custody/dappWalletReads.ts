import { normalizeDappRpcRequest } from '../../../../source/shared/dappRpcReads.ts';
import { normalizeDappWalletRead, projectWalletBalanceUnits, projectWalletAvailableBalanceUnits, projectWalletTokens, readWalletFee,
  walletTokenChainId, type DappWalletReadMethod, type DappWalletTokens } from '../../../../source/shared/dappWalletReads.ts';
import type { NativeConnectionAccount } from '../connections/host.ts';
import { createBalanceReader } from '../platformRpc.ts';
import { createUtxoBalanceReader, type UtxoBalance } from '../core/utxoBalanceReader.ts';
import { openUtxoReadSession } from '../core/utxoReadSession.ts';
import { parseUtxoPublicIdentifier } from '../core/utxoIdentifier.ts';
import type { UtxoNetwork } from '../core/utxoNetworks.ts';
import { snapshotNativeNetwork, type NativeNetworkRegistration } from './networkContext.ts';
import { EvmTransferReadRpc } from './evmTransferReadRpc.ts';
import type { NativeTokenInventory } from '../portfolio/tokenRegistry.ts';

export type WalletReadNetwork = NativeNetworkRegistration | UtxoNetwork;
export type NativeWalletReadHost = Readonly<{
  read(method: DappWalletReadMethod, account: NativeConnectionAccount, signal: AbortSignal, assertCurrent: () => void): Promise<unknown>;
}>;
export const walletTokenScope = (accountId: string, address: string, network: WalletReadNetwork) =>
  JSON.stringify([accountId, address, network.id, network.kind === 'evm' ? network.registrationHash : network.genesisHash, network.kind === 'evm' ? network.rpcUrl : network.endpoint]);

/** Explicit requests share existing readers. Token requests inspect saved/cached data only. */
export function createNativeWalletReadHost(ports: Readonly<{
  network(): WalletReadNetwork;
  fetch(url: string, init: RequestInit): Promise<Response>;
  loadTokens(accountId: string, networkId: string, assertCurrent: () => void): Promise<NativeTokenInventory>;
  cachedTokens(key: string): DappWalletTokens | undefined;
  observeUtxo(account: NativeConnectionAccount, network: UtxoNetwork, balance: UtxoBalance): void;
}>): NativeWalletReadHost {
  return Object.freeze({ async read(method, account, signal, assertCurrent) {
    normalizeDappWalletRead(method, []);
    const selected = ports.network(), identity = JSON.stringify(selected);
    const check = () => {
      assertCurrent();
      if (signal.aborted || JSON.stringify(ports.network()) !== identity) throw Error('CONTEXT_CHANGED');
    };
    check();
    if (method === 'wallet_getTokens') {
      const observed = ports.cachedTokens(walletTokenScope(account.id, account.address, selected));
      if (selected.kind !== 'evm') return projectWalletTokens(observed ?? { ethereum: [], syscoin: [] }, { kind: 'chain', family: 'syscoin', chainId: selected.chainId });
      const chainId = walletTokenChainId(selected.chainId);
      const inventory = await ports.loadTokens(account.id, selected.id, check); check();
      const rows = inventory.items.map(metadata => {
        const cached = observed?.ethereum.find(row => row.chainId === chainId && !row.isNft && Number(row.decimals) === metadata.decimals && row.contractAddress.toLowerCase() === metadata.contractAddress.toLowerCase());
        return { chainId, contractAddress: metadata.contractAddress, decimals: metadata.decimals,
          isNft: false, name: metadata.name, tokenSymbol: metadata.symbol,
          ...(cached?.rawBalance === undefined ? {} : { rawBalance: cached.rawBalance, balance: cached.balance }) };
      });
      const collectibles = (inventory.collectibles ?? []).map(saved => {
        const cached = observed?.ethereum.find(row => row.chainId === chainId && row.isNft && row.tokenStandard === saved.tokenStandard && row.contractAddress.toLowerCase() === saved.contractAddress.toLowerCase() && row.tokenId === ('tokenId' in saved ? saved.tokenId : undefined));
        return { chainId, ...saved, decimals: 0, isNft: true, tokenSymbol: '',
          ...(cached?.rawBalance === undefined ? {} : { rawBalance: cached.rawBalance, balance: cached.balance }) };
      });
      return projectWalletTokens({ ethereum: [...rows, ...collectibles], syscoin: [] }, { kind: 'chain', family: 'ethereum', chainId });
    }
    if (method === 'wallet_getBalance') {
      if (selected.kind === 'evm') {
        const network = snapshotNativeNetwork(selected);
        const value = await createBalanceReader({ fetch: ports.fetch, registrations: () => [network] }).readBalance(network.id, account.address, signal);
        check(); return projectWalletBalanceUnits(value.units, network.decimals);
      }
      const reader = createUtxoBalanceReader({ fetch: ports.fetch });
      const identity = parseUtxoPublicIdentifier(account.xpub, selected);
      const value = identity.kind === 'account'
        ? await reader.readAccount(selected, account.xpub, signal, check)
        : await reader.readBalance(selected, account.address, signal, check);
      check(); ports.observeUtxo(account, selected, value);
      return projectWalletAvailableBalanceUnits(value.confirmedUnits, value.pendingDeltaUnits, selected.decimals);
    }
    return readWalletFee(async () => {
      if (selected.kind === 'evm') {
        return await new EvmTransferReadRpc(snapshotNativeNetwork(selected), { fetch: ports.fetch })
          .dappRequest(normalizeDappRpcRequest('eth_gasPrice', []), signal, check).then(value => BigInt(value as string).toString());
      }
      // Public views and EVM reads must not initialize the Syscoin SDK graph.
      const { readPublicSyscoinFee } = await import('@sidhujag/sysweb3-keyring/cjs/transactions/syscoin-core.js');
      check();
      const session = await openUtxoReadSession(selected, { fetch: ports.fetch, timeoutMs: 12000 }, signal, false, undefined, undefined, check);
      try {
        return await readPublicSyscoinFee(selected.endpoint, { signal, assertCurrent: check, fetch: async input => {
          check();
          if (typeof input !== 'string') throw Error('CONTEXT_CHANGED');
          const url = input;
          const prefix = selected.endpoint.replace(/\/$/, '');
          if (!url.startsWith(prefix + '/api/v2/')) throw Error('CONTEXT_CHANGED');
          return Response.json(await session.read(url.slice(prefix.length)));
        } });
      } finally { session.close(); }
    }, check);
  } });
}
