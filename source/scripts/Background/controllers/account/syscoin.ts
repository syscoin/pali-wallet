import isEmpty from 'lodash/isEmpty';

import { readPublicJson } from '../../../../shared/publicMarketRead';
import store from 'state/store';
import { setAccountAssets } from 'state/vault';
import { ITokenSysProps } from 'types/tokens';

import { getAccountAssets, requireAssetArray } from './getAccountAssets';

export interface ISysAccountController {
  prepareTokenAddition: (
    token: ITokenSysProps,
    owner?: { assertCurrent(): void; signal: AbortSignal }
  ) => Promise<() => ReturnType<typeof setAccountAssets>>;
  prepareTokenRemoval: (
    assetGuid: string
  ) => () => ReturnType<typeof setAccountAssets>;
  setAddress: () => Promise<string>;
}

const SysAccountController = (
  setAddress: () => Promise<string>
): ISysAccountController => {
  const prepareTokenAddition = async (
    token: ITokenSysProps,
    owner?: { assertCurrent(): void; signal: AbortSignal }
  ) => {
    const signal = owner?.signal ?? new AbortController().signal;
    const check = () => {
      owner?.assertCurrent();
      if (signal.aborted)
        throw new Error('Asset context changed. Please try again.');
    };
    check();
    const { activeAccount, activeNetwork, accountAssets } =
      store.getState().vault;
    const activeAccountAssets = getAccountAssets(accountAssets, activeAccount);

    requireAssetArray(activeAccountAssets.syscoin, 'Syscoin');

    // Syscoin 5 no longer uses pubData field
    const description = token.description || '';
    const ipfsUrl = description.startsWith('https://ipfs.io/ipfs/')
      ? description
      : '';
    const { balance, ...tokenMetadata } = token;
    const assetInfos = {
      ...tokenMetadata,
      ...(balance !== undefined ? { balance } : {}),
      chainId: activeNetwork.chainId,
      description,
      image: '',
    };
    if (!isEmpty(ipfsUrl)) {
      try {
        const data = await readPublicJson(fetch, ipfsUrl, 64 * 1024, signal);
        check();
        if (
          data &&
          typeof data === 'object' &&
          typeof (data as { image?: unknown }).image === 'string'
        ) {
          const image = (data as { image: string }).image;
          if (image.length <= 2048) assetInfos.image = image;
        }
      } catch {
        check();
      }
    }

    check();
    return () => {
      check();
      // Metadata and storage can outlive other updates. Always merge into the
      // latest target list and recheck duplicates at each commit boundary.
      const currentAssets = requireAssetArray(
        store.getState().vault.accountAssets?.[activeAccount.type]?.[
          activeAccount.id
        ]?.syscoin,
        'Syscoin'
      );
      if (
        currentAssets.some(
          (asset: ITokenSysProps) =>
            asset.assetGuid === token.assetGuid &&
            asset.chainId === activeNetwork.chainId
        )
      )
        throw new Error('Token already exists');
      return setAccountAssets({
        accountId: activeAccount.id,
        accountType: activeAccount.type,
        property: 'syscoin',
        value: [...currentAssets, assetInfos],
      });
    };
  };

  const prepareTokenRemoval = (assetGuid: string) => {
    const { activeAccount, activeNetwork } = store.getState().vault;
    return () => {
      const { accountAssets } = store.getState().vault;

      const activeAccountAssets = getAccountAssets(
        accountAssets,
        activeAccount
      );

      const currentAssets = requireAssetArray(
        activeAccountAssets.syscoin,
        'Syscoin'
      );

      const matchesToken = (asset: ITokenSysProps) =>
        asset.assetGuid === assetGuid &&
        asset.chainId === activeNetwork.chainId;
      const tokenExists = currentAssets.find(matchesToken);

      if (!tokenExists) throw new Error("Token doesn't exist on this network!");

      return setAccountAssets({
        accountId: activeAccount.id,
        accountType: activeAccount.type,
        property: 'syscoin',
        value: currentAssets.filter(
          (currentToken) => !matchesToken(currentToken)
        ),
      });
    };
  };

  //todo we cannot call those fn directly we should call over keyring manager class

  return {
    setAddress,
    prepareTokenAddition,
    prepareTokenRemoval,
  };
};

export default SysAccountController;
