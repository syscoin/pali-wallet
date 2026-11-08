import React, { useLayoutEffect, useRef } from 'react';
import {
  sameNativePortfolioAccount,
  type NativePortfolioAccount,
} from '../portfolio/nativePortfolio';
import {
  formatTokenUnits,
  type Erc20Metadata,
} from '../../../../source/shared/erc20';
import type {
  NativeTokenSnapshot,
  NativeTokenView,
} from '../portfolio/nativeTokens';
import { Button } from '../ui';

/** Token MAX fills the existing exact-amount form. Network fees remain native currency. */
export function NativeTokenMaximum({
  token,
  snapshot,
  view,
  owner,
  selected,
  disabled,
  onSelect,
}: {
  token: Erc20Metadata;
  owner: NativePortfolioAccount;
  snapshot: NativeTokenSnapshot | null;
  view: Pick<NativeTokenView, 'getSnapshot'> | undefined;
  selected: boolean;
  disabled: boolean;
  onSelect(amount: string): void;
}) {
  const lifetime = useRef<object | null>(null);
  const rendering = {};
  useLayoutEffect(() => {
    lifetime.current = rendering;
    return () => {
      if (lifetime.current === rendering) lifetime.current = null;
    };
  });
  const item = snapshot?.items.find(
    (candidate) =>
      candidate.metadata.contractAddress === token.contractAddress &&
      candidate.metadata.decimals === token.decimals
  );
  let amount: string | null = null;
  if (
    snapshot?.status === 'ready' &&
    sameNativePortfolioAccount(snapshot.account, owner) &&
    item?.status === 'available' &&
    item.units !== null
  ) {
    try {
      if (BigInt(item.units) > BigInt(0))
        amount = formatTokenUnits(item.units, token.decimals);
    } catch {
      /* An unavailable balance cannot populate MAX. */
    }
  }
  return (
    <Button
      title={selected ? 'MAX selected' : 'MAX'}
      variant="quiet"
      disabled={disabled || amount === null}
      onPress={() => {
        if (
          lifetime.current !== rendering ||
          disabled ||
          amount === null ||
          !view ||
          view.getSnapshot() !== snapshot
        )
          return;
        onSelect(amount);
      }}
    />
  );
}
