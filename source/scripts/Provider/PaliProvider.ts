import { browser } from 'webextension-polyfill-ts';
// import { SyscoinTransactions } from '@pollum-io/sysweb3-keyring';
import store from 'state/store';
import {
  getConnectedAccount,
  _getOmittedSensitiveState,
  log,
} from 'utils/index';

export const PaliProvider = () => {
  const connectedAccount = getConnectedAccount();
  // const txs = SyscoinTransactions();

  const { address, balance, xpub, assets } = connectedAccount;

  const getNetwork = () => store.getState().wallet.activeNetwork;

  const getChainId = () => store.getState().wallet.activeNetwork;

  const getState = () => _getOmittedSensitiveState(store.getState().wallet);

  const notifyWalletChanges = async (): Promise<void> => {
    const { wallet } = store.getState();
    const { activeNetworkType } = wallet;

    if (activeNetworkType === 'web3') {
      store.subscribe(async () => {
        const background = await browser.runtime.getBackgroundPage();

        background.dispatchEvent(
          new CustomEvent('walletChanged', {
            detail: {
              data: _getOmittedSensitiveState(wallet),
              chain: 'ethereum',
            },
          })
        );
      });
    }

    log('could not notify wallet changes, network is not web3', 'System');
  };

  const getBalance = () => balance;

  return {
    connectedAccount,
    getBalance,
    address,
    xpub,
    assets,
    getNetwork,
    getChainId,
    getState,
    notifyWalletChanges,
    // we can just call from sysweb3 since we already have new methods for transactions in there as soon as we get the signer issue fixed
    // ...txs
  };
};
