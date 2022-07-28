// import { browser } from 'webextension-polyfill-ts';

// import { SyscoinTransactions } from '@pollum-io/sysweb3-keyring';

// import { listNewDapp } from 'state/dapp';
import store from 'state/store';
// import { removeSensitiveDataFromVault, log, getHost } from 'utils/index';

export const SysProvider = (host: string) => {
  const txs = window.controller.wallet.account.sys.tx;

  const getAccount = () => {
    const account = window.controller.dapp.getAccount(host);
    if (!account) throw new Error('No connected account');

    return account;
  };

  const getNetwork = () => store.getState().vault.activeNetwork;

  const estimateFee = () => txs.getRecommendedFee(getNetwork().url);

  const sendTransaction = (tx) => {
    window.controller.createPopup('tx/send/confirm', tx);
  };

  /* const getState = () => removeSensitiveDataFromVault(store.getState().vault);

  const notifyWalletChanges = async (): Promise<void> => {
    const { vault } = store.getState();
    const { activeNetwork, networks } = vault;

    const isEthereumChain = Boolean(networks.ethereum[activeNetwork.chainId]);
    if (isEthereumChain) {
      store.subscribe(async () => {
        const background = await browser.runtime.getBackgroundPage();

        background.dispatchEvent(
          new CustomEvent('walletChanged', {
            detail: {
              data: removeSensitiveDataFromVault(vault),
              chain: 'ethereum',
            },
          })
        );
      });
    }

    log('could not notify wallet changes, network is not web3', 'System');
  };

  const setAccount = (accountId: number) => {
    const { accounts } = store.getState().vault;
    if (!accounts[accountId]) throw new Error('Account not found');

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
  }; */

  return {
    getAccount: () => getAccount(),
    getAddress: () => getAccount().address,
    getBalance: () => getAccount().balances.syscoin,
    getPublicKey: () => getAccount().xpub,
    getTokens: () => getAccount().assets,
    estimateFee,
    sendTransaction,
  };
};
