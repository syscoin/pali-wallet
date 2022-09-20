import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';

export const SysProvider = (host: string) => {
  const send = (data: {
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

  return {
    send,
    createToken,
    updateToken,
    mintToken,
    createNft,
    mintNft,
    sign,
    signAndSend,
  };
};
