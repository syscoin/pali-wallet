import {
  DeviceManagementKitBuilder,
  type DeviceManagementKit,
} from '@ledgerhq/device-management-kit';
import { RNBleTransport } from '@ledgerhq/device-transport-kit-react-native-ble';
import { AndroidPermissionsService } from '@ledgerhq/device-transport-kit-react-native-ble/api/permissions/AndroidPermissionsService.js';
import { DefaultPermissionsService } from '@ledgerhq/device-transport-kit-react-native-ble/api/permissions/DefaultPermissionsService.js';
import { createSelectedLedgerDmkHost } from '@sidhujag/sysweb3-keyring/esm/ledger/dmk-selected-host';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import {
  ownLedgerTransport,
  type NativeLedgerOwner,
} from './ownedLedgerTransport';

import { ledgerCancelledError } from '@sidhujag/sysweb3-keyring/cjs/ledger/host-types.js';

import type { LedgerEvmConfig } from '@sidhujag/sysweb3-keyring/cjs/ledger/host-types';

/** Called by the native hardware flow after the user chooses Connect Ledger. */
export async function createNativeLedgerTransport(
  owner: NativeLedgerOwner,
  config: LedgerEvmConfig
) {
  owner.assertCurrent();
  if (owner.signal.aborted) throw ledgerCancelledError();
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  owner.signal.addEventListener('abort', abort, { once: true });
  const current: NativeLedgerOwner = {
    signal: lifetime.signal,
    assertCurrent() {
      if (lifetime.signal.aborted) throw ledgerCancelledError();
      owner.assertCurrent();
    },
  };
  let manager: BleManager | undefined;
  let dmk: DeviceManagementKit | undefined;
  try {
    const activeManager = new BleManager();
    manager = activeManager;
    const permissions =
      Platform.OS === 'android'
        ? new AndroidPermissionsService(
            PermissionsAndroid,
            Platform.Version as number
          )
        : new DefaultPermissionsService();
    dmk = new DeviceManagementKitBuilder()
      .addTransport(
        (dependencies) =>
          new RNBleTransport(
            dependencies.deviceModelDataSource,
            dependencies.loggerServiceFactory,
            dependencies.apduSenderServiceFactory,
            dependencies.apduReceiverServiceFactory,
            activeManager,
            Platform,
            {
              async checkRequiredPermissions() {
                current.assertCurrent();
                const granted = await permissions.checkRequiredPermissions();
                current.assertCurrent();
                return granted;
              },
              async requestRequiredPermissions() {
                current.assertCurrent();
                const granted = await permissions.requestRequiredPermissions();
                current.assertCurrent();
                return granted;
              },
            }
          )
      )
      .build();
    const host = createSelectedLedgerDmkHost({ ...config, dmk });
    const transport = ownLedgerTransport(current, dmk, host, async () => {
      owner.signal.removeEventListener('abort', abort);
      await activeManager.destroy();
    });
    return {
      ...transport,
      dispose() {
        lifetime.abort();
        return transport.dispose();
      },
    };
  } catch (error) {
    owner.signal.removeEventListener('abort', abort);
    lifetime.abort();
    try {
      dmk?.close();
    } finally {
      await manager?.destroy();
    }
    throw error;
  }
}
