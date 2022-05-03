import store from 'state/store';
import {
  setActiveAccount,
  setActiveAccountProperty,
  setIsPendingBalances,
} from 'state/vault';
import { KeyringManager, Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { IKeyringAccountState } from '@pollum-io/sysweb3-utils';
import { setActiveNetwork } from '@pollum-io/sysweb3-network';
import { CoingeckoCoins } from 'types/controllers';

import SysTrezorController from '../trezor/syscoin';
import { SysTransactionController } from '../transaction';

const SysAccountController = () => {
  const keyringManager = KeyringManager();

  const getLatestUpdate = async (silent?: boolean) => {
    if (!silent) store.dispatch(setIsPendingBalances(true));

    const { activeAccount, networks, activeNetwork } = store.getState().vault;

    if (!activeAccount) return;

    const updatedAccountInfo = await keyringManager.getLatestUpdateForAccount();

    store.dispatch(setIsPendingBalances(false));

    const isSyscoinChain = Boolean(networks.syscoin[activeNetwork.chainId]);

    const { assets } = updatedAccountInfo;

    const storedAssets = activeAccount.assets.filter((asset: any) =>
      assets.filter(
        (activeAccountAsset: any) => activeAccountAsset.id !== asset.id
      )
    );

    store.dispatch(
      setActiveAccount({
        ...activeAccount,
        ...updatedAccountInfo,
        assets: isSyscoinChain ? assets : storedAssets,
      })
    );
  };

  /** check if there is no pending transaction in mempool
   *  and get the latest update for account
   */
  const watchMemPool = (currentAccount: IKeyringAccountState | undefined) => {
    // 30 seconds - 3000 milliseconds
    const interval = 30 * 1000;

    const intervalId = setInterval(() => {
      getLatestUpdate(true);

      if (!currentAccount || !currentAccount?.transactions) {
        clearInterval(intervalId);

        return false;
      }
    }, interval);

    return true;
  };

  const setAddress = async (): Promise<string> => {
    // @ts-ignore
    const { receivingAddress } =
      await keyringManager.getLatestUpdateForAccount();

    store.dispatch(
      setActiveAccountProperty({
        property: 'address',
        value: String(receivingAddress),
      })
    );

    return receivingAddress;
  };

  const getErc20TokenBalance = async (
    activeNetwork: any,
    tokenAddress: any,
    walletAddress: string
  ) => {
    try {
      setActiveNetwork(activeNetwork);

      return await Web3Accounts().getBalanceOfAnyToken(
        tokenAddress,
        walletAddress
      );
    } catch (error) {
      return 0;
    }
  };

  const saveTokenInfo = async (token: CoingeckoCoins) => {
    const { activeAccount, activeNetwork } = store.getState().vault;

    const isSyscoinChain = activeNetwork.currency === 'sys';

    const web3TokenBalance: any =
      !isSyscoinChain &&
      token &&
      (await getErc20TokenBalance(
        activeNetwork,
        token.contract_address,
        activeAccount.address
      ));

    const web3Token = {
      ...token,
      balance: web3TokenBalance,
    };

    store.dispatch(
      setActiveAccountProperty({
        property: 'assets',
        value: [...activeAccount.assets, !isSyscoinChain ? web3Token : token],
      })
    );
  };

  const trezor = SysTrezorController();
  const tx = SysTransactionController();

  return {
    watchMemPool,
    trezor,
    tx,
    setAddress,
    getLatestUpdate,
    saveTokenInfo,
  };
};

export default SysAccountController;
