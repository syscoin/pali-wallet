import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  decodeAssetTransfer,
  type AssetTransferCall,
} from '../../shared/assetTransfer';
import { createAssetTransferDisplay } from '../../shared/assetTransferDisplay';
import { createErc20Policy } from '../../shared/erc20';
import { useController } from 'hooks/useController';
import store, { RootState } from 'state/store';
import { getAddress } from 'utils/ethersV6Compat';
import type { IEvmTransactionContext } from 'utils/evmTransactionContext';

import type { ApprovalContractMetadata } from '../../shared/approval';

type Call = Readonly<{ data?: string; to?: string | null }>;
const tokenPolicy = createErc20Policy(getAddress);
const contextKey = (state: Pick<RootState, 'vault' | 'vaultGlobal'>) => {
  const { vault, vaultGlobal } = state;
  if (!vault?.activeAccount || !vault.activeNetwork) return null;
  const { activeAccount, activeNetwork } = vault;
  return JSON.stringify([
    Boolean(vault.isBitcoinBased),
    activeAccount.type,
    activeAccount.id,
    vault.accounts[activeAccount.type]?.[
      activeAccount.id
    ]?.address?.toLowerCase(),
    activeNetwork.chainId,
    activeNetwork.url,
    vaultGlobal?.activeSlip44,
  ]);
};

/** Optional public display reads never change a reviewed call or its consent. */
export function useAssetTransferSummaries(
  calls: readonly Call[],
  approvedContext: IEvmTransactionContext,
  request: string
) {
  const { controllerEmitter } = useController();
  const selected = useSelector(contextKey);
  const encoded = JSON.stringify(calls.map((call) => [call.to, call.data]));
  const scope = useMemo(
    () => ({
      selected,
      request,
      encoded,
      approvedContext,
      calls: calls.map((call) => ({ to: call.to, data: call.data })),
      transfers: calls.map((call) => decodeAssetTransfer(call.data, call.to)),
      expected: JSON.stringify([
        false,
        approvedContext.account.type,
        approvedContext.account.id,
        approvedContext.account.address.toLowerCase(),
        approvedContext.chainId,
        approvedContext.rpcUrl,
        approvedContext.slip44,
      ]),
      // The serialized call list is the exact immutable review input.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [selected, request, encoded, approvedContext]
  );
  const latest = useRef(scope);
  latest.current = scope;
  const [enriched, setEnriched] = useState<{
    scope: typeof scope;
    transfers: readonly (AssetTransferCall | null)[];
  }>();
  useEffect(() => {
    let live = true;
    const current = () =>
      live &&
      latest.current === scope &&
      scope.selected === scope.expected &&
      contextKey(store.getState()) === scope.expected;
    if (!current()) return;
    const read = async () => {
      const transfers = [...scope.transfers];
      // A single request may repeat a contract. Read each at most once, in
      // order, and recheck the complete owner before starting the next read.
      const metadata = new Map<string, ApprovalContractMetadata | null>();
      for (let index = 0; index < transfers.length; index++) {
        const transfer = transfers[index];
        if (!transfer || transfer.standard !== 'Unknown') continue;
        if (!current()) return;
        if (!metadata.has(transfer.contract)) {
          let observed: ApprovalContractMetadata | null = null;
          try {
            const classification = (await controllerEmitter(
              ['wallet', 'checkContractType'],
              [
                transfer.contract,
                approvedContext.account.address,
                approvedContext,
              ]
            )) as { type?: unknown } | undefined;
            if (!current()) return;
            if (
              classification?.type === 'ERC-721' ||
              classification?.type === 'ERC-1155'
            ) {
              observed = { standard: classification.type };
            } else if (classification?.type === 'ERC-20') {
              const result = (await controllerEmitter(
                ['wallet', 'getERC20TokenInfo'],
                [
                  transfer.contract,
                  approvedContext.account.address,
                  approvedContext,
                ]
              )) as { decimals: number; name: string; symbol: string };
              if (!current()) return;
              observed = {
                standard: 'ERC-20',
                token: tokenPolicy.parseMetadata({
                  contractAddress: transfer.contract,
                  name: result.name,
                  symbol: result.symbol,
                  decimals: result.decimals,
                }),
              };
            }
          } catch {
            if (!current()) return;
          }
          metadata.set(transfer.contract, observed);
        }
        const observed = metadata.get(transfer.contract);
        if (observed)
          transfers[index] = decodeAssetTransfer(
            scope.calls[index]?.data,
            transfer.contract,
            observed
          );
      }
      if (current()) setEnriched({ scope, transfers });
    };
    void read();
    return () => {
      live = false;
    };
    // calls and the controller are read through the captured request scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  const transfers =
    enriched?.scope === scope ? enriched.transfers : scope.transfers;
  return transfers.map((transfer) =>
    transfer ? createAssetTransferDisplay(transfer) : null
  );
}
