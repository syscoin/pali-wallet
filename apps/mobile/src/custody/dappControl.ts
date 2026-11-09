import { EthereumRpcErrorHandler } from '../../../../source/helpers/errors/errorClassesHandlers.ts';
import type {
  DappWatchAssetRequest,
} from '../../../../source/shared/dappWalletControl.ts';
import type {
  NativeDappControlHost,
  NativeDappControlContext,
  NativePreparedDappControl,
 NativeDappControlRequest } from '../connections/controlRequests.ts';
import type { NativeNetworkSelection } from './walletCatalogue.ts';
import {
  createNativeNetwork,
  type NativeNetworkRegistration,
} from './networkContext.ts';
import type { NativeNetworkView } from './networkView.ts';
import { EvmTransferReadRpc } from './evmTransferReadRpc.ts';
import { prepareNativeDappModeControl } from './dappModeControl.ts';
import type { UtxoNetwork } from '../core/utxoNetworks.ts';
import type { NativeNetworkSelectionReceipt } from './accounts.ts';

export type NativeDappControlPorts = Readonly<{
  networks: NativeNetworkView;
  context(): NativeDappControlContext | null;
  utxoNetworks(): readonly UtxoNetwork[];
  previewNetworkSelection(id: string, expectedCatalogueRevision: number): NativeNetworkSelection;
  fetch(url: string, init: RequestInit): Promise<Response>;
  prepareWatchAsset(
    request: DappWatchAssetRequest,
    owner: Readonly<{ accountId: string; networkId: string; address: string }>,
    signal: AbortSignal,
    assertRequestCurrent: () => void
  ): Promise<NativePreparedDappControl>;
}>;
const changed = (): never => {
  throw new Error('CONTEXT_CHANGED');
};
/** Uses the wallet's existing verified network selection/registration and guarded asset capabilities. */
export function createNativeDappControlHost(
  ports: NativeDappControlPorts
): NativeDappControlHost {
  return Object.freeze({
    context: ports.context,
    async prepare(
      request: NativeDappControlRequest,
      owner,
      signal,
      assertRequestCurrent
    ) {
      if ('kind' in request) return prepareNativeDappModeControl(ports, request, owner, signal, assertRequestCurrent);
      const captured = ports.context();
      if (!captured) return changed();
      let disposed = false,
        networkCommit = false;
      const assertOwner = () => {
        if (disposed || signal.aborted) return changed();
        assertRequestCurrent();
        const current = ports.context();
        if (!current || !current.accounts.some(account => account.id === owner.accountId && account.address === owner.address && account.slip44 === 60))
          return changed();
        return current;
      };
      const check = () => {
        const current = assertOwner();
        if (
          current.revision !== captured.revision ||
          current.catalogueRevision !== captured.catalogueRevision ||
          current.activeAccountId !== captured.activeAccountId ||
          current.networkId !== owner.networkId ||
          captured.networkId !== owner.networkId
        )
          changed();
      };
      check();
      if (request.method === 'wallet_watchAsset') {
        if (captured.activeAccountId !== owner.accountId) return changed();
        return ports.prepareWatchAsset(request, owner, signal, check);
      }
      const initial = ports.networks.getSnapshot();
      if (!initial) return changed();
      if (initial.revision !== captured.catalogueRevision) return changed();
      const selected = initial.selectedId;
      const checkCatalogue = () => {
        check();
        if (ports.networks.getSnapshot()?.revision !== initial.revision)
          changed();
      };
      let registration = initial.networks.find(
        (network) => network.registration?.chainId === String(request.chainId)
      )?.registration;
      const exists = !!registration;
      if (!registration && request.method === 'wallet_switchEthereumChain')
        throw new EthereumRpcErrorHandler(
          4902,
          'Chain not found. Please add it first using wallet_addEthereumChain.'
        );
      if (!registration) {
        const suggestions =
          (!request.chainName || !request.nativeCurrency?.symbol) &&
          ports.networks.loadCatalogue
            ? await ports.networks.loadCatalogue()
            : [];
        checkCatalogue();
        const suggestion = suggestions.find(
          (chain) => chain.chainId === request.chainId
        );
        if (request.nativeCurrency && request.nativeCurrency.decimals !== 18)
          throw new EthereumRpcErrorHandler(
            4200,
            'This currency precision is unavailable'
          );
        const rpcUrl = request.rpcUrls[0];
        if (!rpcUrl)
          throw new EthereumRpcErrorHandler(
            -32602,
            'Valid rpcUrls are required'
          );
        registration = createNativeNetwork({
          id: `custom:${request.chainId}`,
          name: request.chainName || suggestion?.name || '',
          kind: 'evm',
          chainId: String(request.chainId),
          slip44: 60,
          rpcUrl,
          symbol:
            request.nativeCurrency?.symbol ||
            suggestion?.nativeCurrency.symbol ||
            '',
          decimals: 18,
          testnet: suggestion?.isTestnet ?? false,
        });
        await new EvmTransferReadRpc(registration, {
          fetch: ports.fetch,
        }).verifyNetwork(signal, checkCatalogue);
        checkCatalogue();
      }
      const reviewed: NativeNetworkRegistration = registration;
      const changesSelection = request.method === 'wallet_switchEthereumChain' && reviewed.id !== selected;
      const mutates = changesSelection || !exists;
      const expected = changesSelection
        ? ports.previewNetworkSelection(reviewed.id, initial.revision)
        : { accountId: captured.activeAccountId, address: captured.accounts.find(account => account.id === captured.activeAccountId)?.address, networkId: selected };
      if (!expected.address) return changed();
      checkCatalogue();
      const stop = () => {
        if (networkCommit) ports.networks.cancel();
      };
      signal.addEventListener('abort', stop, { once: true });
      return Object.freeze({
        details: Object.freeze({
          kind:
            request.method === 'wallet_switchEthereumChain'
              ? 'network-switch'
              : 'network-add',
          chainId: reviewed.chainId,
          name: reviewed.name,
          rpcUrl: reviewed.rpcUrl,
          symbol: reviewed.symbol,
        }),
        assertCurrent: checkCatalogue,
        async commit(checkRequest) {
          checkCatalogue();
          checkRequest();
          networkCommit = true;
          let receipt: NativeNetworkSelectionReceipt | undefined;
          try {
            if (request.method === 'wallet_switchEthereumChain') {
              if (reviewed.id !== selected)
                receipt = await ports.networks.select(
                  reviewed.id,
                  captured.revision,
                  initial.revision
                );
            } else if (!exists) {
              if (!ports.networks.save)
                throw new EthereumRpcErrorHandler(
                  4200,
                  'Adding networks is unavailable'
                );
              await ports.networks.save(
                reviewed,
                captured.revision,
                initial.revision
              );
            }
          } finally {
            networkCommit = false;
          }
          if (changesSelection) {
            if (!receipt) return changed();
            receipt.assertCurrent();
            if (receipt.sourceContextRevision !== captured.revision || receipt.sourceCatalogueRevision !== initial.revision || receipt.contextRevision !== captured.revision + 1 || receipt.catalogueRevision !== initial.revision + 1 || receipt.target.kind !== 'evm' || receipt.target.registrationHash !== reviewed.registrationHash || receipt.selection.accountId !== expected.accountId || receipt.selection.address !== expected.address || receipt.selection.networkId !== expected.networkId) return changed();
          }
          const committed = assertOwner(),
            catalogue = ports.networks.getSnapshot();
          const expectedSelected =
            request.method === 'wallet_switchEthereumChain'
              ? reviewed.id
              : selected;
          if (
            !catalogue ||
            committed.revision !== captured.revision + Number(mutates) ||
            committed.catalogueRevision !== initial.revision + Number(mutates) ||
            committed.activeAccountId !== expected.accountId ||
            committed.networkId !== expected.networkId ||
            !committed.accounts.some(account => account.id === expected.accountId && account.address === expected.address) ||
            catalogue.revision !== initial.revision + Number(mutates) ||
            catalogue.selectedId !== expectedSelected ||
            !catalogue.networks.some(
              (network) =>
                network.registration?.registrationHash ===
                reviewed.registrationHash
            )
          )
            return changed();
          const assertCommitted = () => {
            checkRequest();
            receipt?.assertCurrent();
            const current = assertOwner(),
              next = ports.networks.getSnapshot();
            if (
              current.revision !== committed.revision ||
              current.catalogueRevision !== committed.catalogueRevision ||
              current.activeAccountId !== expected.accountId ||
              !current.accounts.some(account => account.id === expected.accountId && account.address === expected.address) ||
              current.networkId !== committed.networkId ||
              next?.revision !== catalogue.revision ||
              next.selectedId !== expectedSelected ||
              !next.networks.some(
                (network) =>
                  network.registration?.registrationHash ===
                  reviewed.registrationHash
              )
            )
              changed();
          };
          assertCommitted();
          return Object.freeze({
            result: null,
            assertCurrent: assertCommitted,
          });
        },
        dispose() {
          stop();
          disposed = true;
          signal.removeEventListener('abort', stop);
        },
      });
    },
  });
}
