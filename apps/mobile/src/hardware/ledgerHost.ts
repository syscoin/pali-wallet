import { ledgerCancelledError, ledgerHostError } from '@sidhujag/sysweb3-keyring/cjs/ledger/host-types.js';
import { assertHardwareOperationCurrent } from '@sidhujag/sysweb3-keyring/cjs/hardware-transaction-authority.js';
import type { LedgerHost } from '@sidhujag/sysweb3-keyring/cjs/ledger/host-types';
import type { NativeLedgerTransport } from './ownedLedgerTransport.ts';

/** Stable SDK capability. Only the explicit native picker installs a transport. */
export function createNativeLedgerHost(
  current: () => NativeLedgerTransport | undefined
): LedgerHost {
  const requireHost = () => {
    const transport = current();
    if (!transport?.host.getStatus().connected)
      throw ledgerHostError(
        'HARDWARE_SIGNER_UNAVAILABLE',
        'Select a Ledger device first'
      );
    return transport.host;
  };
  return {
    getStatus: () => current()?.host.getStatus() ?? { connected: false },
    connect: async () => {
      requireHost();
    },
    disconnect: async () => {
      await current()?.dispose();
    },
    retire: async () => {
      const transport = current();
      await transport?.dispose();
      const assertRetired = transport ? await transport.host.retire() : () => undefined;
      return () => {
        if (current() !== transport) throw ledgerCancelledError();
        assertHardwareOperationCurrent(assertRetired);
      };
    },
    evm: {
      getAddress: (...args) => requireHost().evm.getAddress(...args),
      signTransaction: (...args) => requireHost().evm.signTransaction(...args),
      signPersonalMessage: (...args) =>
        requireHost().evm.signPersonalMessage(...args),
      signTypedData: (...args) => requireHost().evm.signTypedData(...args),
    },
    utxo: {
      getXpub: (...args) => requireHost().utxo.getXpub(...args),
      getAddress: (...args) => requireHost().utxo.getAddress(...args),
      getAccount: (...args) => requireHost().utxo.getAccount(...args),
      signMessage: (...args) => requireHost().utxo.signMessage(...args),
      signPsbt: (...args) => requireHost().utxo.signPsbt(...args),
    },
  };
}
