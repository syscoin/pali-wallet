import { isValidSYSAddress as _isValidSYSAddress } from '@pollum-io/sysweb3-utils';

import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { isNFT as _isNFT } from 'scripts/Background/controllers/utils';
import store from 'state/store';
export const SysProvider = (host: string) => {
  const sendTransaction = (data: {
    amount: number;
    fee: number;
    receivingAddress: string;
    tokenGuid?: string;
    verifyAddress?: boolean;
    zDag?: boolean;
  }) =>
    popupPromise({
      host,
      data: {
        isToken: data.tokenGuid !== undefined,
        verifyAddress: data.verifyAddress,
        zDag: data.zDag,
        ...data,
      },
      route: 'tx/send',
      eventName: 'txSend',
    });

  //* ----- Token -----
  const createToken = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/asset/create',
      eventName: 'txCreateToken',
    });
  const transferAssetOwnership = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/asset/transfer',
      eventName: 'txTransferAssetOwnership',
    });

  const updateToken = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/asset/update',
      eventName: 'txUpdateToken',
    });

  const mintToken = (data: {
    amount: number;
    assetGuid: string;
    fee: number;
  }) =>
    popupPromise({
      host,
      data,
      route: 'tx/asset/mint',
      eventName: 'txMintToken',
    });

  //* ----- NFT -----
  const createNft = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/asset/nft/create',
      eventName: 'txCreateNFT',
    });

  const mintNft = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/asset/nft/mint',
      eventName: 'txMintNFT',
    });

  //* ----- Sign -----
  const sign = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/sign-psbt',
      eventName: 'txSign',
    });

  const signAndSend = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/sign',
      eventName: 'txSignAndSend',
    });

  const isNFT = (data) => _isNFT(data[0] as number);

  const isValidSYSAddress = (data) => {
    const { activeNetwork } = store.getState().vault;
    const isValid = _isValidSYSAddress(data, activeNetwork); //Validate by coinType inside sysweb3 //todo: we should adjust with the new keyring types and funtionalites
    return isValid;
  };

  return {
    sendTransaction,
    createToken,
    updateToken,
    mintToken,
    transferAssetOwnership,
    createNft,
    mintNft,
    sign,
    signAndSend,
    isNFT,
    isValidSYSAddress,
  };
};
