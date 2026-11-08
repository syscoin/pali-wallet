import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const state: any = { created: 0, destroyed: 0, checks: 0, requests: 0 };
(globalThis as any).__paliLedgerFactory = state;
const source = new URL(
  '../src/hardware/ledgerTransport.native.ts',
  import.meta.url
).href;
const mocks: Record<string, string> = {
  '@ledgerhq/device-management-kit': `
    export class DeviceManagementKitBuilder {
      addTransport(factory) { this.factory = factory; return this; }
      build() {
        this.factory({});
        if (globalThis.__paliLedgerFactory.failBuild) throw Error('build failed');
        return globalThis.__paliLedgerFactory.dmk;
      }
    }`,
  '@ledgerhq/device-transport-kit-react-native-ble': `
    export class RNBleTransport {
      constructor(...args) { globalThis.__paliLedgerFactory.permissions = args[6]; }
    }`,
  '@ledgerhq/device-transport-kit-react-native-ble/api/permissions/AndroidPermissionsService.js': `
    export class AndroidPermissionsService {
      async checkRequiredPermissions() {
        const state = globalThis.__paliLedgerFactory; state.checks++;
        return state.check ? state.check() : true;
      }
      async requestRequiredPermissions() { globalThis.__paliLedgerFactory.requests++; return true; }
    }`,
  '@ledgerhq/device-transport-kit-react-native-ble/api/permissions/DefaultPermissionsService.js': `
    export class DefaultPermissionsService {}`,
  '@sidhujag/sysweb3-keyring/esm/ledger/dmk-selected-host': `
    export function createSelectedLedgerDmkHost(config) {
      globalThis.__paliLedgerFactory.config = config;
      if (globalThis.__paliLedgerFactory.failHost) throw Error('host failed');
      return globalThis.__paliLedgerFactory.host;
    }`,
  'react-native': `export const Platform = { OS: 'android', Version: 35 }; export const PermissionsAndroid = {};`,
  'react-native-ble-plx': `
    export class BleManager {
      constructor() { globalThis.__paliLedgerFactory.created++; }
      async destroy() { globalThis.__paliLedgerFactory.destroyed++; }
    }`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === source) {
      if (mocks[specifier])
        return {
          shortCircuit: true,
          url: 'data:text/javascript,' + encodeURIComponent(mocks[specifier]),
        };
      if (specifier === './ownedLedgerTransport') {
        return next('./ownedLedgerTransport.ts', context);
      }
    }
    return next(specifier, context);
  },
});
const { createNativeLedgerTransport } = await import(source);
hooks.deregister();

test('native construction uses official adapters, defers permission and retires delayed permission continuations', async () => {
  state.dmk = { stopDiscovering: async () => undefined, close() {} };
  state.host = {
    disconnect: async () => undefined,
    evm: {},
    utxo: {},
  };
  const owner = new AbortController();
  const confirmBlindSigning = async () => false;
  const transport = await createNativeLedgerTransport(
    {
      signal: owner.signal,
      assertCurrent() {},
    },
    { confirmBlindSigning }
  );
  assert.equal(state.created, 1);
  assert.equal(state.checks, 0);
  assert.equal(state.requests, 0);
  assert.equal(state.config.dmk, state.dmk);
  assert.equal(state.config.confirmBlindSigning, confirmBlindSigning);
  let release!: (value: boolean) => void;
  state.check = () =>
    new Promise<boolean>((resolve) => {
      release = resolve;
    });
  const checking = state.permissions.checkRequiredPermissions();
  await transport.dispose();
  release(true);
  await assert.rejects(checking, /cancel/i);
  await assert.rejects(
    state.permissions.requestRequiredPermissions(),
    /cancel/i
  );
  assert.equal(state.requests, 0);
  assert.equal(state.destroyed, 1);
});

test('an already retired owner cannot initialize Bluetooth', async () => {
  const owner = new AbortController();
  owner.abort();
  await assert.rejects(
    createNativeLedgerTransport(
      { signal: owner.signal, assertCurrent() {} },
      {}
    ),
    /cancel/i
  );
  assert.equal(state.created, 1);
});

test('failed vendor initialization closes the owned native manager', async () => {
  state.failBuild = true;
  const owner = new AbortController();
  await assert.rejects(
    createNativeLedgerTransport(
      { signal: owner.signal, assertCurrent() {} },
      {}
    ),
    /build failed/
  );
  assert.equal(state.created, 2);
  assert.equal(state.destroyed, 2);
  state.failBuild = false;
});

test('failed host initialization still destroys Bluetooth when DMK cleanup throws', async () => {
  state.failHost = true;
  state.dmk.close = () => {
    throw Error('DMK cleanup failed');
  };
  const owner = new AbortController();
  await assert.rejects(
    createNativeLedgerTransport(
      { signal: owner.signal, assertCurrent() {} },
      {}
    ),
    /DMK cleanup failed/
  );
  assert.equal(state.created, 3);
  assert.equal(state.destroyed, 3);
  state.failHost = false;
});
