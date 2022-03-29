import { browser } from 'webextension-polyfill-ts';
// import { SyscoinTransactions } from '@pollum-io/sysweb3-keyring';
import store from 'state/store';
import {
  getConnectedAccount,
  _getOmittedSensitiveState,
  log,
  getHost,
} from 'utils/index';
import { listNewDapp } from 'state/dapp';

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

  const setAccount = (accountId: number) => {
    console.log('setting account', accountId);
    const { accounts } = store.getState().wallet;

    if (!accounts.find((account) => account.id === accountId))
      return new Error('Account not found');

    const { origin } = window.controller.dapp.getCurrent();

    const id = getHost(origin);

    const currentDapp = store.getState().dapp.whitelist[id];

    store.dispatch(
      listNewDapp({
        id,
        accountId,
        dapp: currentDapp,
      })
    );
  };

  return {
    connectedAccount,
    assets,
    getNetwork,
    getChainId,
    getState,
    notifyWalletChanges,
    setAccount,
    getBalance: () => balance,
    getAccounts: () => connectedAccount,
    getPublicKey: () => xpub,
    getAddress: () => address,
    // we can just call from sysweb3 since we already have new methods for transactions in there as soon as we get the signer issue fixed
    // ...txs
  };
};
