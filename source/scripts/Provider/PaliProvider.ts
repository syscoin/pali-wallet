import store from 'state/store';
import { getConnectedAccount, _getOmittedSensitiveState } from 'utils/index';

export const PaliProvider = () => {
  const connectedAccount = getConnectedAccount('Syscoin');

  const { address, balance, xpub, assets } = connectedAccount;

  const getNetwork = () => store.getState().wallet.activeNetwork;

  const getChainId = () => store.getState().wallet.activeNetwork;

  const getState = () => _getOmittedSensitiveState();

  return {
    connectedAccount,
    balance,
    address,
    xpub,
    assets,
    getNetwork,
    getChainId,
    getState,
  };
};
