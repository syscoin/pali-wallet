import type {
  KeyringHardware,
  KeyringHost,
  KeyringOptions,
  HostKeyring,
} from '@sidhujag/sysweb3-keyring/cjs/host-keyring.js';
import type { LedgerKeyring } from '@sidhujag/sysweb3-keyring/cjs/ledger/index.js';

type NativeHostKeyring = HostKeyring<LedgerKeyring, undefined>;
export type NativeKeyringSdk =
  typeof import('@sidhujag/sysweb3-keyring/cjs/software.js') & {
    HostKeyring: {
      new (
        host: KeyringHost,
        options: KeyringOptions,
        hardware: () => KeyringHardware<LedgerKeyring, undefined>
      ): NativeHostKeyring;
      readonly prototype: NativeHostKeyring;
    };
    submitSignedHardwareEvmTransaction: typeof import('@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js').submitSignedHardwareEvmTransaction;
    signLedgerEvmTransaction: typeof import('@sidhujag/sysweb3-keyring/cjs/transactions/ledger-signing.js').signLedgerEvmTransaction;
    convertExtendedKeyVersion: typeof import('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths.js').convertExtendedKeyVersion;
    createLedgerHardware: typeof import('@sidhujag/sysweb3-keyring/cjs/ledger-hardware.js').createLedgerHardware;
  };

/** Load only after native crypto initialization. Both hosts use HostKeyring. */
export async function loadNativeKeyringSdk(): Promise<NativeKeyringSdk> {
  const [software, host, ledger, derivation, signing, submission] =
    await Promise.all([
      import('@sidhujag/sysweb3-keyring/cjs/software.js'),
      import('@sidhujag/sysweb3-keyring/cjs/host-keyring.js'),
      import('@sidhujag/sysweb3-keyring/cjs/ledger-hardware.js'),
      import('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths.js'),
      import('@sidhujag/sysweb3-keyring/cjs/transactions/ledger-signing.js'),
      import('@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js'),
    ]);
  return {
    ...software,
    HostKeyring: host.HostKeyring,
    convertExtendedKeyVersion: derivation.convertExtendedKeyVersion,
    signLedgerEvmTransaction: signing.signLedgerEvmTransaction,
    submitSignedHardwareEvmTransaction:
      submission.submitSignedHardwareEvmTransaction,
    createLedgerHardware: ledger.createLedgerHardware,
  };
}
