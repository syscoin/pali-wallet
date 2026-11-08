import { createTestEvmSubmissionCapture } from '../helpers/evmSubmission';

import type { KeyringManagerOptions } from '@sidhujag/sysweb3-keyring';

type Sdk = typeof import('@sidhujag/sysweb3-keyring');

type LedgerHost = NonNullable<KeyringManagerOptions['ledgerHost']>;
export function createOfflineTrezorHost(): KeyringManagerOptions['trezorHost'] {
  const { TREZOR_METHODS } = jest.requireActual(
    '@sidhujag/sysweb3-keyring/cjs/trezor/host-types'
  );
  const unavailable = async () => {
    throw new Error('Trezor is unavailable in this offline fixture');
  };
  return {
    ...Object.fromEntries(
      TREZOR_METHODS.map((method: string) => [method, unavailable])
    ),
    init: unavailable,
    async dispose(pending: readonly Promise<unknown>[]) {
      await Promise.allSettled(pending);
    },
  } as unknown as KeyringManagerOptions['trezorHost'];
}
const offlineLedgerHost: LedgerHost = {
  async connect() {
    return undefined;
  },
  async disconnect() {
    return undefined;
  },
  async retire() {
    return () => undefined;
  },
  getStatus: () => ({ connected: false }),
  evm: {} as LedgerHost['evm'],
  utxo: {} as LedgerHost['utxo'],
};

export function createTestKeyringManager(
  sdk: Sdk = jest.requireActual('@sidhujag/sysweb3-keyring'),
  options: KeyringManagerOptions = {
    ledgerHost: offlineLedgerHost,
    trezorHost: createOfflineTrezorHost(),
    captureEvmSubmission: createTestEvmSubmissionCapture(),
  }
) {
  const records = new Map<string, unknown>();
  const host = sdk.createKeyringHost({
    async get(key) {
      return records.get(key);
    },
    async set(key, value) {
      records.set(key, value);
    },
    async deleteItem(key) {
      records.delete(key);
    },
    async createManyIfAbsent(items) {
      if (Object.keys(items).some((key) => records.has(key))) return false;
      for (const [key, value] of Object.entries(items)) records.set(key, value);
      return true;
    },
  });
  return new sdk.KeyringManager(host, options);
}
