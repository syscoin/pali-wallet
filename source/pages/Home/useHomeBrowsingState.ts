import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useContextualState } from 'hooks/useContextualState';
import { keccak256, toUtf8Bytes } from 'utils/ethersV6Compat';

/** Only public list preferences belong here; transaction drafts stay in their flow. */
export const useHomeBrowsingState = <T extends Record<string, any>>(
  key: 'homeAssets' | 'homeActivity' | 'nftView',
  scope: string,
  initial: T,
  restore?: (value: T) => T | undefined
) => {
  const location = useLocation();
  const navigate = useNavigate();
  const saved = location.state?.[key];
  const savedValue =
    saved?.scope === scope
      ? restore
        ? restore(saved.value)
        : saved.value
      : undefined;
  const restored = { ...initial, ...savedValue };
  const [value, setValue] = useContextualState<T>(scope, restored);

  useEffect(() => {
    const snapshot = { scope, value };
    if (JSON.stringify(saved) === JSON.stringify(snapshot)) return;
    // Replace this entry so editing a filter never adds a Back step.
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: { ...location.state, [key]: snapshot },
    });
  }, [key, scope, value, saved, location, navigate]);

  return [value, setValue] as const;
};

export interface IHomeAssetsView {
  isCoinSelected: boolean;
  nftsVisibleCount: number;
  searchValue: string;
  sortByValue: string;
  tokensVisibleCount: number;
}

export const DEFAULT_ASSETS_VIEW: IHomeAssetsView = {
  isCoinSelected: true,
  nftsVisibleCount: 50,
  searchValue: '',
  sortByValue: '',
  tokensVisibleCount: 50,
};

/** Include endpoints because two custom networks can share a chain ID. */
export const getHomeBrowsingScope = (
  account: any,
  network: any,
  isBitcoinBased = false
) =>
  keccak256(
    toUtf8Bytes(
      JSON.stringify([
        account?.type,
        account?.id,
        account?.address,
        account?.xpub,
        isBitcoinBased,
        network?.kind,
        network?.slip44,
        network?.chainId,
        network?.url,
        network?.apiUrl,
      ])
    )
  );
