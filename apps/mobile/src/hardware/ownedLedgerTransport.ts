import { ledgerCancelledError } from '@sidhujag/sysweb3-keyring/cjs/ledger/host-types.js';

import type {
  DeviceManagementKit,
  DiscoveredDevice,
} from '@ledgerhq/device-management-kit';
import type { LedgerDmkHost } from '@sidhujag/sysweb3-keyring/esm/ledger/dmk-selected-host';

export type NativeLedgerOwner = Readonly<{
  signal: AbortSignal;
  assertCurrent(): void;
}>;

export type NativeLedgerTransport = Readonly<{
  host: LedgerDmkHost;
  observeDevices(
    onDevices: (devices: readonly DiscoveredDevice[]) => void,
    onError: (error: unknown) => void
  ): Promise<() => Promise<void>>;
  dispose(): Promise<void>;
}>;

/** Own native resources; all device selection and signing stay in the shared SDK. */
export function ownLedgerTransport(
  owner: NativeLedgerOwner,
  dmk: Pick<
    DeviceManagementKit,
    'listenToAvailableDevices' | 'stopDiscovering' | 'close'
  >,
  sharedHost: LedgerDmkHost,
  closeNative: () => Promise<void>
): NativeLedgerTransport {
  let disposed = false;
  let disposal: Promise<void> | undefined;
  let discovery: { stop(): Promise<void> } | undefined;
  const statusSubscriptions = new Map<() => void, () => void>();
  let stopping: Promise<void> = Promise.resolve();
  const assertCurrent = () => {
    if (disposed || owner.signal.aborted) throw ledgerCancelledError();
    owner.assertCurrent();
  };
  assertCurrent();
  const guard =
    <Args extends unknown[], Result>(
      operation: (...args: Args) => Promise<Result>
    ) =>
    async (...args: Args): Promise<Result> => {
      assertCurrent();
      try {
        const result = await operation(...args);
        assertCurrent();
        return result;
      } catch (error) {
        assertCurrent();
        throw error;
      }
    };
  const host: LedgerDmkHost = {
    connect: guard((...args) => sharedHost.connect(...args)),
    disconnect: () => sharedHost.disconnect(),
    retire: () => sharedHost.retire(),
    getStatus: () => ({
      connected:
        !disposed && !owner.signal.aborted && sharedHost.getStatus().connected,
    }),
    subscribeStatus(listener) {
      assertCurrent();
      let active = true;
      const remove = sharedHost.subscribeStatus(() => {
        if (!active) return;
        try {
          assertCurrent();
        } catch {
          return;
        }
        listener();
      });
      const unsubscribe = () => {
        active = false;
        remove();
        statusSubscriptions.delete(unsubscribe);
      };
      statusSubscriptions.set(unsubscribe, listener);
      if (disposed || owner.signal.aborted) unsubscribe();
      return unsubscribe;
    },
    beginDeviceSelection: (signal) => {
      assertCurrent();
      return guard(sharedHost.beginDeviceSelection(signal));
    },
    evm: {
      getAddress: guard((...args) => sharedHost.evm.getAddress(...args)),
      signTransaction: guard((...args) =>
        sharedHost.evm.signTransaction(...args)
      ),
      signPersonalMessage: guard((...args) =>
        sharedHost.evm.signPersonalMessage(...args)
      ),
      signTypedData: guard((...args) => sharedHost.evm.signTypedData(...args)),
    },
    utxo: {
      getXpub: guard((...args) => sharedHost.utxo.getXpub(...args)),
      getAddress: guard((...args) => sharedHost.utxo.getAddress(...args)),
      getAccount: guard((...args) => sharedHost.utxo.getAccount(...args)),
      signMessage: guard((...args) => sharedHost.utxo.signMessage(...args)),
      signPsbt: guard((...args) => sharedHost.utxo.signPsbt(...args)),
    },
  };
  const dispose = () => {
    if (disposal) return disposal;
    let resolveDisposal!: () => void;
    let rejectDisposal!: (error: unknown) => void;
    disposal = new Promise<void>((resolve, reject) => {
      resolveDisposal = resolve;
      rejectDisposal = reject;
    });
    disposed = true;
    for (const [unsubscribe, listener] of [...statusSubscriptions]) {
      try {
        listener();
      } catch {
        /* A disconnect observer cannot prevent cleanup. */
      }
      unsubscribe();
    }
    owner.signal.removeEventListener('abort', onAbort);
    // The wrapper is already revoked. Capture synchronous SDK failures so
    // native cleanup still drains and the reserved disposal promise settles.
    const retirement = Promise.resolve().then(() => sharedHost.retire());
    const cleanup = (async () => {
      const results = await Promise.allSettled([
        retirement,
        discovery ? discovery.stop() : stopping,
      ]);
      try {
        dmk.close();
      } finally {
        await closeNative();
      }
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    })();
    void cleanup.then(resolveDisposal, rejectDisposal);
    return disposal;
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  owner.signal.addEventListener('abort', onAbort, { once: true });
  return {
    host,
    async observeDevices(onDevices, onError) {
      assertCurrent();
      await stopping;
      assertCurrent();
      if (discovery) throw new Error('Ledger discovery is already active');
      const subscription = dmk.listenToAvailableDevices({}).subscribe({
        next(devices) {
          if (disposed || owner.signal.aborted) return;
          try {
            assertCurrent();
          } catch {
            return;
          }
          onDevices(devices);
        },
        error(error) {
          if (!disposed && !owner.signal.aborted) onError(error);
        },
      });
      let cleanup: Promise<void> | undefined;
      const current = {
        stop() {
          if (cleanup) return cleanup;
          subscription.unsubscribe();
          if (discovery === current) discovery = undefined;
          cleanup = stopping.then(
            () => dmk.stopDiscovering(),
            () => dmk.stopDiscovering()
          );
          stopping = cleanup;
          return cleanup;
        },
      };
      discovery = current;
      if (disposed || owner.signal.aborted) await current.stop();
      return current.stop;
    },
    dispose,
  };
}
