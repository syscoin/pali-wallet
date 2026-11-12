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
import { useNativeTranslation } from '../platform/localization';

export function nativeTokenAvailableAmount(token: Erc20Metadata, owner: NativePortfolioAccount, snapshot: NativeTokenSnapshot | null): string | null {
  const item = snapshot?.items.find(candidate => candidate.metadata.contractAddress === token.contractAddress && candidate.metadata.decimals === token.decimals);
  if (snapshot?.status !== 'ready' || !sameNativePortfolioAccount(snapshot.account, owner) || item?.status !== 'available' || item.units === null) return null;
  try { return formatTokenUnits(item.units, token.decimals); } catch { return null; }
}

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
  const { t } = useNativeTranslation();
  const lifetime = useRef<object | null>(null);
  const rendering = {};
  useLayoutEffect(() => {
    lifetime.current = rendering;
    return () => {
      if (lifetime.current === rendering) lifetime.current = null;
    };
  });
  const available = nativeTokenAvailableAmount(token, owner, snapshot);
  const amount = available !== null && /[1-9]/.test(available) ? available : null;
  return (
    <Button
      title={t(selected ? 'mobile.portfolioCopy.maxSelected' : 'send.max')}
      variant="secondary"
      size="compact"
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
