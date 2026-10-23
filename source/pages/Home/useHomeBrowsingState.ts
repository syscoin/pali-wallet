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
    const path = `${location.pathname}${location.search}${location.hash}`;
    const nativeRoute = window.location.hash.startsWith('#/')
      ? window.location.hash.slice(1)
      : undefined;
    const nativeKey = window.history.state?.key;
    // A pending lazy transition can leave this list mounted after navigation.
    // Its late data must not replace another native route or same-path entry.
    if (
      nativeRoute &&
      (nativeRoute !== path ||
        (typeof nativeKey === 'string' &&
          typeof location.key === 'string' &&
          nativeKey !== location.key))
    )
      return;
    const snapshot = { scope, value };
    if (JSON.stringify(saved) === JSON.stringify(snapshot)) return;
    // Replace this entry so editing a filter never adds a Back step.
    navigate(path, {
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
