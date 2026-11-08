import type {
  KeyringHardware,
  KeyringHost,
  KeyringOptions,
  HostKeyring,
} from '@sidhujag/sysweb3-keyring/cjs/host-keyring.js';
import type { LedgerKeyring } from '@sidhujag/sysweb3-keyring/cjs/ledger/index.js';
import type { TrezorKeyring } from '@sidhujag/sysweb3-keyring/cjs/trezor/index.js';

type NativeHostKeyring = HostKeyring<LedgerKeyring, TrezorKeyring | undefined>;
export type NativeKeyringSdk =
  typeof import('@sidhujag/sysweb3-keyring/cjs/software.js') & {
    HostKeyring: {
      new (
        host: KeyringHost,
        options: KeyringOptions,
        hardware: () => KeyringHardware<LedgerKeyring, TrezorKeyring | undefined>
      ): NativeHostKeyring;
      readonly prototype: NativeHostKeyring;
    };
    submitSignedHardwareEvmTransaction: typeof import('@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js').submitSignedHardwareEvmTransaction;
    signLedgerEvmTransaction: typeof import('@sidhujag/sysweb3-keyring/cjs/transactions/ledger-signing.js').signLedgerEvmTransaction;
    signTrezorEvmTransaction: typeof import('@sidhujag/sysweb3-keyring/cjs/transactions/trezor-signing.js').signTrezorEvmTransaction;
    convertExtendedKeyVersion: typeof import('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths.js').convertExtendedKeyVersion;
    createLedgerHardware: typeof import('@sidhujag/sysweb3-keyring/cjs/ledger-hardware.js').createLedgerHardware;
    createTrezorHardware: typeof import('@sidhujag/sysweb3-keyring/cjs/trezor-hardware.js').createTrezorHardware;
  };

/** Load only after native crypto initialization. Both hosts use HostKeyring. */
export async function loadNativeKeyringSdk(): Promise<NativeKeyringSdk> {
  const [software, host, ledger, trezor, derivation, signing, trezorSigning, submission] =
    await Promise.all([
      import('@sidhujag/sysweb3-keyring/cjs/software.js'),
      import('@sidhujag/sysweb3-keyring/cjs/host-keyring.js'),
      import('@sidhujag/sysweb3-keyring/cjs/ledger-hardware.js'),
      import('@sidhujag/sysweb3-keyring/cjs/trezor-hardware.js'),
      import('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths.js'),
      import('@sidhujag/sysweb3-keyring/cjs/transactions/ledger-signing.js'),
      import('@sidhujag/sysweb3-keyring/cjs/transactions/trezor-signing.js'),
      import('@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js'),
    ]);
  return {
    ...software,
    HostKeyring: host.HostKeyring,
    convertExtendedKeyVersion: derivation.convertExtendedKeyVersion,
    signLedgerEvmTransaction: signing.signLedgerEvmTransaction,
    signTrezorEvmTransaction: trezorSigning.signTrezorEvmTransaction,
    submitSignedHardwareEvmTransaction:
      submission.submitSignedHardwareEvmTransaction,
    createLedgerHardware: ledger.createLedgerHardware,
    createTrezorHardware: trezor.createTrezorHardware,
  };
}
