import { INetwork } from '@pollum-io/sysweb3-network';

export const dispatchChangeNetworkBgEvent = (
  network: INetwork,
  isBitcoinBased: boolean
) => {
  chrome.runtime.sendMessage({
    type: 'changeNetwork',
    target: 'background',
    data: { network, isBitcoinBased },
  });
};
