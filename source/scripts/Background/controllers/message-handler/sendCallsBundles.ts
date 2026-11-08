import {
  createCallsBundleRegistry,
  assertCallsBundleStore,
  type CallsBundleStore,
} from '../../../../wallet/dappCallsBundles.ts';
export type { EoaSendCallsReservation } from '../../../../wallet/dappCallsBundles.ts';

const STORAGE_KEY = 'pali-sendcalls-bundles';
type Registry = ReturnType<typeof createCallsBundleRegistry>;
let owner: Readonly<{ assertCurrent(): void; registry: Registry }> | undefined;

/** One background realm owns this Chrome record across ordinary wallet locks. */
function ownedRegistry() {
  if (owner) return owner;
  const runtime = chrome.runtime;
  const storage = chrome.storage.local;
  const runtimeId = runtime.id;
  const check = () => {
    if (
      chrome.runtime !== runtime ||
      chrome.storage.local !== storage ||
      runtime.id !== runtimeId
    )
      throw new Error('Calls bundle owner changed');
  };
  const registry = createCallsBundleRegistry({
    assertCurrent: check,
    now: () => Date.now(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    storage: {
      read: () =>
        new Promise<CallsBundleStore>((resolve, reject) => {
          check();
          storage.get([STORAGE_KEY], (result) => {
            if (runtime.lastError) {
              console.error(
                '[sendCallsBundles] Failed to read store:',
                runtime.lastError
              );
              reject(new Error('Unable to read sendCalls bundle reservations'));
              return;
            }
            try {
              const value = result?.[STORAGE_KEY] || {};
              assertCallsBundleStore(value);
              resolve(value);
            } catch (error) {
              reject(error);
            }
          });
        }),
      write: (next, assertCurrent) =>
        new Promise<void>((resolve, reject) => {
          // This background realm is the sole writer; the shared registry owns
          // the read/modify/write queue and checks before the Chrome commit.
          assertCurrent();
          storage.set({ [STORAGE_KEY]: next }, () => {
            if (runtime.lastError) {
              console.error(
                '[sendCallsBundles] Failed to write store:',
                runtime.lastError
              );
              reject(
                new Error('Unable to persist sendCalls bundle reservations')
              );
              return;
            }
            resolve();
          });
        }),
    },
  });
  owner = Object.freeze({ registry, assertCurrent: check });
  return owner;
}

export const generateWalletBundleId = () =>
  ownedRegistry().registry.generateWalletBundleId();
export const getStoredSendCallsBundle = (
  ...args: Parameters<
    ReturnType<typeof createCallsBundleRegistry>['getStoredSendCallsBundle']
  >
) => ownedRegistry().registry.getStoredSendCallsBundle(...args);
export const reserveSendCallsBundle = (
  ...args: Parameters<
    ReturnType<typeof createCallsBundleRegistry>['reserveSendCallsBundle']
  >
) => ownedRegistry().registry.reserveSendCallsBundle(...args);
export const recordSendCallsBundle = (
  ...args: Parameters<
    ReturnType<typeof createCallsBundleRegistry>['recordSendCallsBundle']
  >
) => ownedRegistry().registry.recordSendCallsBundle(...args);
export const releaseSendCallsBundleReservation = (
  ...args: Parameters<
    ReturnType<
      typeof createCallsBundleRegistry
    >['releaseSendCallsBundleReservation']
  >
) => ownedRegistry().registry.releaseSendCallsBundleReservation(...args);
export const captureStartedEoaSendCallsAttempt = (
  ...args: Parameters<
    ReturnType<
      typeof createCallsBundleRegistry
    >['captureStartedEoaSendCallsAttempt']
  >
) => ownedRegistry().registry.captureStartedEoaSendCallsAttempt(...args);
export const resolveSendCallsBundleDescriptor = (
  ...args: Parameters<
    ReturnType<
      typeof createCallsBundleRegistry
    >['resolveSendCallsBundleDescriptor']
  >
) => ownedRegistry().registry.resolveSendCallsBundleDescriptor(...args);
export const resolveCallsStatus = (
  getProviderForChain: (chainId: number) => any | null,
  host: string,
  id: string
) => {
  const owned = ownedRegistry();
  return owned.registry.resolveCallsStatus(
    {
      assertCurrent: owned.assertCurrent,
      forChain: getProviderForChain,
    },
    host,
    id
  );
};
