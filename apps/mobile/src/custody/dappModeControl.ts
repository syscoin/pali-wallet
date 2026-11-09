import type { DappModeRequest } from '../../../../source/shared/dappChainScope.ts';
import { dappCaipChain, requiresDappModeSwitch } from '../../../../source/shared/dappChainScope.ts';
import { EthereumRpcErrorHandler } from '../../../../source/helpers/errors/errorClassesHandlers.ts';
import type { NativeDappControlContext, NativePreparedDappControl } from '../connections/controlRequests.ts';
import type { NativeNetworkView } from './networkView.ts';
import type { NativeNetworkSelection } from './walletCatalogue.ts';
import type { NativeNetworkSelectionReceipt } from './accounts.ts';
import type { UtxoNetwork } from '../core/utxoNetworks.ts';
type Ports = Readonly<{
  networks: NativeNetworkView; context(): NativeDappControlContext | null;
  utxoNetworks(): readonly UtxoNetwork[];
}>;
/** Existing network/account selection, including full UTXO registration and exact post-state. */
export function prepareNativeDappModeControl(ports: Ports, request: DappModeRequest,
  owner: Readonly<{ accountId: string; networkId: string; address: string }>, signal: AbortSignal,
  assertRequestCurrent: () => void): NativePreparedDappControl {
  const captured = ports.context(), initial = ports.networks.getSnapshot(), utxos = ports.utxoNetworks();
  let disposed = false, committing = false;
  const fail = (): never => { throw new Error('CONTEXT_CHANGED'); };
  if (!captured || !initial || captured.networkId !== owner.networkId || captured.catalogueRevision !== initial.revision) return fail();
  const utxo = request.kind === 'syscoin' ? utxos.find(network => network.chainId === request.chainId) : undefined;
  const evm = request.kind === 'ethereum' ? initial.networks.find(network => network.registration?.chainId === String(request.chainId))?.registration : undefined;
  if (!utxo && !evm) throw new EthereumRpcErrorHandler(4902, 'Network does not exist');
  const targetRegistration = utxo ?? evm!;
  const target = utxo ? { id: utxo.id, name: utxo.name, symbol: utxo.symbol, rpcUrl: utxo.endpoint,
    chainId: dappCaipChain({ kind: 'syscoin', chainId: utxo.chainId, slip44: utxo.slip44, genesisHash: utxo.genesisHash }) } : { id: evm!.id, name: evm!.name, symbol: evm!.symbol, rpcUrl: evm!.rpcUrl, chainId: evm!.chainId };
  const currentUtxo = utxos.some(network => network.id === captured.networkId);
  const shouldSwitch = target.id !== captured.networkId && requiresDappModeSwitch(request, currentUtxo ? 'syscoin' : 'ethereum');
  const unchanged = {
    accountId: captured.activeAccountId, networkId: captured.networkId,
    address: captured.accounts.find(account => account.id === captured.activeAccountId)?.address,
  };
  const registration = JSON.stringify(utxos);
  const checkBase = () => {
    assertRequestCurrent(); if (disposed || signal.aborted) return fail();
    const current = ports.context();
    if (!current || !current.accounts.some(account => account.id === owner.accountId && account.address === owner.address) || JSON.stringify(ports.utxoNetworks()) !== registration) return fail();
    return current;
  };
  const check = () => {
    const current = checkBase();
    if (current.revision !== captured.revision || current.catalogueRevision !== initial.revision || current.networkId !== captured.networkId || current.activeAccountId !== captured.activeAccountId || ports.networks.getSnapshot()?.revision !== initial.revision) fail();
  };
  check();
  const abort = () => { if (committing) ports.networks.cancel(); };
  signal.addEventListener('abort', abort, { once: true });
  return Object.freeze({ details: Object.freeze({ kind: 'network-switch', name: target.name, chainId: target.chainId, symbol: target.symbol, rpcUrl: target.rpcUrl }), assertCurrent: check,
    async commit(guard) {
      check(); guard(); committing = true;
      let receipt: NativeNetworkSelectionReceipt | undefined;
      try { if (shouldSwitch) receipt = await ports.networks.select(target.id, captured.revision, initial.revision); }
      finally { committing = false; }
      const post = () => {
        guard(); const current = checkBase(), catalogue = ports.networks.getSnapshot();
        let expected: NativeNetworkSelection | typeof unchanged;
        if (shouldSwitch) {
          if (!receipt) return fail();
          receipt.assertCurrent();
          if (receipt.sourceContextRevision !== captured.revision || receipt.sourceCatalogueRevision !== initial.revision || receipt.contextRevision !== captured.revision + 1 || receipt.catalogueRevision !== initial.revision + 1 || receipt.selection.networkId !== target.id || JSON.stringify(receipt.target) !== JSON.stringify(targetRegistration)) return fail();
          expected = receipt.selection;
        } else expected = unchanged;
        if (current.revision !== captured.revision + Number(shouldSwitch) || current.catalogueRevision !== initial.revision + Number(shouldSwitch) || current.activeAccountId !== expected.accountId || current.networkId !== expected.networkId || !current.accounts.some(account => account.id === expected.accountId && account.address === expected.address) || catalogue?.revision !== current.catalogueRevision || catalogue.selectedId !== expected.networkId) fail();
      };
      post(); return Object.freeze({ result: null, assertCurrent: post });
    },
    dispose() { abort(); disposed = true; signal.removeEventListener('abort', abort); },
  });
}
