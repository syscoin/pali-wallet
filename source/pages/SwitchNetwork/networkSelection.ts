import { INetwork } from 'types/network';

export type NetworkSelection = {
  current: INetwork;
};

export const getInitialNetworkSelection = (
  activeNetwork: INetwork | undefined,
  isTypeSwitch?: boolean
): NetworkSelection | null =>
  isTypeSwitch || !activeNetwork ? null : { current: activeNetwork };

export const isSameNetworkSelection = (
  first: INetwork | undefined,
  second: INetwork
): boolean =>
  Boolean(
    first &&
      first.kind === second.kind &&
      first.chainId === second.chainId &&
      first.url === second.url
  );
