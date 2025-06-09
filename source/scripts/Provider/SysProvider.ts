import { isValidSYSAddress as _isValidSYSAddress } from '@pollum-io/sysweb3-utils';

import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { isNFT as _isNFT } from 'scripts/Background/controllers/utils';
import store from 'state/store';
export const SysProvider = (host: string) => {
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
    const isValid = _isValidSYSAddress(data, activeNetwork.chainId); //Validate by coinType inside sysweb3 //todo: we should adjust with the new keyring types and funtionalites
    return isValid;
  };

  return {
    sign,
    signAndSend,
    isNFT,
    isValidSYSAddress,
  };
};
