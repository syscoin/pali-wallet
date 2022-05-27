import { KeyringManager } from '@pollum-io/sysweb3-keyring';

const SysTrezorController = () => {
  const { trezor } = KeyringManager();

  const createAccount = () => trezor.createWallet();

  return {
    createAccount,
  };
};

export default SysTrezorController;
