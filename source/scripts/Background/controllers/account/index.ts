import store from 'state/store';
import { Web3Accounts } from '@pollum-io/sysweb3-keyring';

import SysAccountController from './syscoin';

const WalletController = (): { account: any; addAccount: any } => {
  const { activeNetwork } = store.getState().vault;

  const isSyscoinNetwork = activeNetwork.chainId === 57;

  const controller = {
    account: isSyscoinNetwork ? SysAccountController() : Web3Accounts(),
  };

  const addAccount = (label: string) => {
    // if (!walletCreation) {
    //   await sysjs.Signer.createAccount();
    // }
    // const res: IAccountInfo | null = await getAccountInfo();
    // let mainAddress = '';
    // try {
    //   mainAddress = await sysjs.Signer.getNewReceivingAddress(true);
    // } catch (error: any) {
    //   throw new Error(error);
    // }
    // account = {
    //   id:
    //     sysjs.Signer.Signer.accountIndex === 0
    //       ? 0
    //       : sysjs.Signer.Signer.accountIndex,
    //   label: label || `Account ${sysjs.Signer.Signer.accountIndex + 1}`,
    //   balance: res.balance,
    //   transactions: res.transactions,
    //   xpub: sysjs.Signer.getAccountXpub(),
    //   xprv: CryptoJS.AES.encrypt(
    //     sysjs.Signer.Signer.accounts[
    //       sysjs.Signer.Signer.accountIndex
    //     ].getAccountPrivateKey(),
    //     encriptedPassword
    //   ).toString(),
    //   address: { main: mainAddress },
    //   assets: res.assets,
    //   connectedTo: [],
    //   isTrezorWallet: false,
    // };
    // store.dispatch(createAccount(account));
    // return account!.xpub;
  };

  return { ...controller, addAccount };
};

export default WalletController;
