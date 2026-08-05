import { INetwork } from 'types/network';

export type NetworkSelection = {
  current: INetwork;
};

export const getInitialNetworkSelection = (
  activeNetwork: INetwork | undefined,
  isTypeSwitch?: boolean
): NetworkSelection | null =>
  isTypeSwitch || !activeNetwork ? null : { current: activeNetwork };
