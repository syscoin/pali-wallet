import {
  IKeyringAccountState,
  KeyringManager,
} from '@pollum-io/sysweb3-keyring';

export interface ISysTrezorController {
  createAccount: () => Promise<IKeyringAccountState>;
}

const SysTrezorController = (): ISysTrezorController => {
  const { trezor } = KeyringManager();

  const createAccount = async () => await trezor.createHardwareWallet();

  return {
    createAccount,
  };
};

export default SysTrezorController;
