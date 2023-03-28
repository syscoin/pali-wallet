import axios from 'axios';

import { KeyringManager } from '@pollum-io/sysweb3-keyring';

import SysTrezorController, { ISysTrezorController } from '../trezor/syscoin';
import store from 'state/store';
import { setActiveAccountProperty } from 'state/vault';
import { ITokenSysProps } from 'types/tokens';

export interface ISysAccountController {
  // getLatestUpdate: (silent?: boolean) => Promise<void>;
  saveTokenInfo: (token: ITokenSysProps) => Promise<void>;
  setAddress: () => Promise<string>;
  trezor: ISysTrezorController;
  // tx: ISyscoinTransactions;
  // watchMemPool: () => void;
}

const SysAccountController = (
  getKeyring: () => KeyringManager
): ISysAccountController => {
  //todo: we need to check if we will need to get from main controller or initialize it again with opts
  // const keyringManager = new KeyringManager();

  // id for `watchMemPool` setInterval
  // let intervalId: NodeJS.Timer;

  // const getLatestUpdate = async (silent?: boolean) => {
  //   const { activeAccountId, isBitcoinBased, accounts, activeNetwork } =
  //     store.getState().vault;
  //   const accountId = activeAccountId;
  //   if (!accounts[accountId].address) return;

  //   if (!silent) store.dispatch(setIsPendingBalances(true));

  //   store.dispatch(setIsLoadingTxs(true));
  //   const { walleAccountstLatestUpdate } =
  //     await keyringManager.getLatestUpdateForAccount();
  //   store.dispatch(setIsPendingBalances(false));

  //   const hash = isBitcoinBased ? 'txid' : 'hash';

  //   store.dispatch(setIsLoadingTxs(false));

  //   const formattedWalletAccountsLatestUpdates = Object.assign(
  //     {},
  //     await Promise.all(
  //       Object.values(walleAccountstLatestUpdate).map(
  //         async (account: any, index) => {
  //           const { transactions: updatedTxs } = account;

  //           const allTxs = [
  //             ...accounts[index].transactions,
  //             ...updatedTxs,
  //           ].filter(
  //             (value, i, self) =>
  //               i ===
  //               self.findIndex((tx) => tx && value && tx[hash] === value[hash])
  //           ); // to get array with unique txs.

  //           if (isBitcoinBased)
  //             return {
  //               ...account,
  //               label: accounts[index].label,
  //               transactions: [...allTxs],
  //               assets: {
  //                 ethereum: accounts[index].assets.ethereum,
  //                 syscoin: account.assets,
  //               },
  //             };
  //           else {
  //             //UPDATE ETH ERC TOKEN BALANCES
  //             const getUpdatedErcTokens = await getBalanceUpdatedToErcTokens(
  //               accounts[index].id
  //             );

  //             return {
  //               ...account,
  //               label: accounts[index].label,
  //               assets: {
  //                 syscoin: accounts[index].assets.syscoin,
  //                 ethereum: getUpdatedErcTokens,
  //               },
  //               transactions: [...allTxs],
  //             };
  //           }
  //         }
  //       )
  //     )
  //   );

  //   store.dispatch(setAccounts({ ...formattedWalletAccountsLatestUpdates }));

  //   resolve();

  //   const isUpdating = store.getState().vault.isNetworkChanging;
  //   window.controller.dapp.handleBlockExplorerChange(
  //     PaliSyscoinEvents.blockExplorerChanged,
  //     {
  //       method: PaliSyscoinEvents.blockExplorerChanged,
  //       params: isBitcoinBased ? activeNetwork.url : null,
  //     }
  //   );
  //   if (!isUpdating)
  //     window.controller.dapp.handleStateChange(PaliEvents.chainChanged, {
  //       method: PaliEvents.chainChanged,
  //       params: {
  //         chainId: `0x${activeNetwork.chainId.toString(16)}`,
  //         networkVersion: activeNetwork.chainId,
  //       },
  //     });
  //   else store.dispatch(setIsNetworkChanging(false));
  // };

  /** check if there is no pending transaction in mempool
   *  and get the latest update for account
   */
  // const watchMemPool = () => {
  //   if (intervalId) clearInterval(intervalId);
  //   //TODO: this should be enhanced and its only being set after user refresh the wallet
  //   // 30 seconds - 3000 milliseconds
  //   const interval = 30 * 1000;

  //   intervalId = setInterval(() => {
  //     const { activeAccountId, accounts } = store.getState().vault;

  //     if (
  //       !accounts[activeAccountId].address ||
  //       !accounts[activeAccountId].transactions
  //     ) {
  //       clearInterval(intervalId);

  //       return;
  //     }

  //     getLatestUpdate(true);
  //   }, interval);
  // };

  const setAddress = async (): Promise<string> => {
    const keyringManager = getKeyring();
    const address = await keyringManager.updateReceivingAddress();

    store.dispatch(
      setActiveAccountProperty({
        property: 'address',
        value: String(address),
      })
    );

    return address;
  };

  const saveTokenInfo = async (token: ITokenSysProps) => {
    try {
      const { activeAccount, accounts } = store.getState().vault;

      const tokenExists = accounts[activeAccount.type][
        activeAccount.id
      ].assets.syscoin.find(
        (asset: ITokenSysProps) => asset.assetGuid === token.assetGuid
      );

      if (tokenExists) throw new Error('Token already exists');

      const description =
        token.pubData && token.pubData.desc ? atob(token.pubData.desc) : '';

      const ipfsUrl = description.startsWith('https://ipfs.io/ipfs/')
        ? description
        : '';

      const { data } = await axios.get(ipfsUrl);

      const image = data && data.image ? data.image : '';

      const asset = {
        ...token,
        description,
        image,
        balance: Number(token.balance) / 10 ** Number(token.decimals),
      };

      store.dispatch(
        setActiveAccountProperty({
          property: 'assets',
          value: [
            ...accounts[activeAccount.type][activeAccount.id].assets.syscoin,
            asset,
          ],
        })
      );
    } catch (error) {
      throw new Error(`Could not save token info. Error: ${error}`);
    }
  };

  //todo we cannot call those fn directly we should call over keyring manager class
  const trezor = SysTrezorController();
  // const tx = keyringManager.syscoinTransaction;

  return {
    // watchMemPool,
    trezor,
    // tx,
    setAddress,
    // getLatestUpdate,
    saveTokenInfo,
  };
};

export default SysAccountController;
