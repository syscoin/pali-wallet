import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDappSessions,
  type DappPermissionFrame,
  type DappSessionEvent,
  type DappSessionHost,
  type DappWalletContext,
} from '../../../source/wallet/dappSessions.ts';
import type { DappGrant, DappPublicAccount } from '../../../source/shared/dappTypes.ts';
import type { INetwork, KeyringAccountType } from '../../../source/types/network.ts';

const origin = 'https://connected.invalid';
const accountType = 'HDAccount' as KeyringAccountType;

function fixture(kind: 'ethereum' | 'syscoin' = 'ethereum') {
  const network: INetwork = {
    kind: kind as INetwork['kind'],
    chainId: kind === 'ethereum' ? 137 : 57,
    slip44: kind === 'ethereum' ? 60 : 57,
    currency: kind === 'ethereum' ? 'POL' : 'SYS',
    label: 'Selected network',
    url: 'https://selected-rpc.invalid',
  };
  let wallet: DappWalletContext = {
    generation: 1,
    isBitcoinBased: kind === 'syscoin',
    network,
    activeSlip44: network.slip44,
    unlocked: true,
  };
  const accounts: Record<number, DappPublicAccount> = {
    0: { address: '0x1111111111111111111111111111111111111111', xpub: 'public-account-0' },
    1: { address: '0x2222222222222222222222222222222222222222', xpub: 'public-account-1' },
  };
  let frame: DappPermissionFrame = { dapps: {}, pendingOrigins: [] };
  let stored: DappPermissionFrame = frame;
  let queue = Promise.resolve();
  let beforeWrite = async () => {};
  let beforeDelivery = async () => {};
  const deliveries: DappSessionEvent[] = [];
  const host: DappSessionHost = {
    wallet: () => wallet,
    account: (id, type) => type === accountType ? accounts[id] : undefined,
    canPublishAccount: (account) => Boolean(account),
    isAccountAvailable: (account) => Boolean(account),
    permissions: {
      assertWritable() {},
      exclusive(operation) {
        const result = queue.then(operation);
        queue = result.then(() => undefined, () => undefined);
        return result;
      },
      read: () => frame,
      async write(value) {
        const snapshot = structuredClone(value);
        await beforeWrite();
        stored = snapshot;
      },
      publish(value) { frame = value; },
    },
    async resolveDelivery() {
      await beforeDelivery();
      return async (prepare, isCurrent) => {
        if (isCurrent()) deliveries.push(prepare());
      };
    },
    async providerAvailability() {},
    notifyConnection() {},
    clearProviderCache() {},
    now: () => 1000,
    reportError() {},
  };
  const sessions = createDappSessions(host);
  const grant: DappGrant = { host: origin, accountId: 0, accountType, chain: network.kind, chainId: network.chainId, date: 1 };
  const context = (id = 0) => ({ ...accounts[id]!, network: { ...wallet.network } });
  return {
    sessions, grant, context, accounts, deliveries,
    frame: () => frame,
    stored: () => stored,
    setWallet(value: Partial<DappWalletContext>) { wallet = { ...wallet, ...value }; },
    setBeforeWrite(value: () => Promise<void>) { beforeWrite = value; },
    setBeforeDelivery(value: () => Promise<void>) { beforeDelivery = value; },
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('the common dapp engine runs on a native host without browser globals', async () => {
  assert.equal(typeof (globalThis as { chrome?: unknown }).chrome, 'undefined');
  const f = fixture();
  await f.sessions.connect(f.grant, f.context());
  await settle();
  assert.equal(f.sessions.isConnected(origin), true);
  assert.equal(f.sessions.getAccount(origin)?.address, f.accounts[0]!.address);
  assert.deepEqual(f.stored().dapps[origin], f.grant);
  assert.deepEqual(f.stored().pendingOrigins, []);
  assert.deepEqual(f.deliveries.find((event) => event.method === 'pali_accountsChanged')?.params, [f.accounts[0]!.address]);
});

test('a native host must provide the complete permission and transport contract', () => {
  assert.throws(() => createDappSessions({} as DappSessionHost), /explicit dapp session host/);
});

test('connection admission requires an exact origin and approved network', async () => {
  const f = fixture();
  await assert.rejects(f.sessions.connect({ ...f.grant, host: `${origin}/path` }, f.context()), /complete requesting origin/);
  await assert.rejects(f.sessions.connect(f.grant, { ...f.context(), network: { ...f.context().network, chainId: 1 } }), /Account context changed/);
  assert.deepEqual(f.stored().dapps, {});
});

test('delivery reads current lock state after asynchronous transport lookup', async () => {
  const f = fixture();
  await f.sessions.connect(f.grant, f.context());
  await settle();
  f.deliveries.length = 0;
  let release!: () => void;
  f.setBeforeDelivery(() => new Promise<void>((resolve) => { release = resolve; }));
  await f.sessions.handleStateChange('pali_accountsChanged', { method: 'pali_accountsChanged', params: [f.accounts[0]!.address] });
  f.setWallet({ unlocked: false });
  release();
  await settle();
  assert.deepEqual(f.deliveries, [{ method: 'pali_accountsChanged', params: [] }]);
});

test('a retired network event is discarded after asynchronous transport lookup', async () => {
  const f = fixture();
  await f.sessions.connect(f.grant, f.context());
  await settle();
  f.deliveries.length = 0;
  let release!: () => void;
  f.setBeforeDelivery(() => new Promise<void>((resolve) => { release = resolve; }));
  await f.sessions.handleStateChange('pali_chainChanged', { method: 'pali_chainChanged', params: '0x89' });
  await settle();
  f.setWallet({ generation: 2 });
  release();
  await settle();
  assert.deepEqual(f.deliveries, []);
});

test('a stalled old recipient lookup cannot block the current network event', async () => {
  const f = fixture();
  await f.sessions.connect(f.grant, f.context());
  await settle();
  f.deliveries.length = 0;
  let release!: () => void;
  let lookups = 0;
  f.setBeforeDelivery(async () => {
    lookups += 1;
    if (lookups === 1) await new Promise<void>((resolve) => { release = resolve; });
  });
  await f.sessions.handleStateChange('pali_chainChanged', { method: 'pali_chainChanged', params: '0x89' });
  await settle();
  f.setWallet({ network: { ...f.context().network, chainId: 42161 } as INetwork });
  await f.sessions.handleStateChange('pali_chainChanged', { method: 'pali_chainChanged', params: '0xa4b1' });
  await settle();
  assert.deepEqual(f.deliveries, [{ method: 'pali_chainChanged', params: '0xa4b1' }]);
  release();
  await settle();
  assert.deepEqual(f.deliveries, [{ method: 'pali_chainChanged', params: '0xa4b1' }]);
});

test('UTXO grants survive receive-address rotation and reject replacement accounts', async () => {
  const f = fixture('syscoin');
  await f.sessions.connect(f.grant, f.context());
  assert.deepEqual(f.stored().dapps[origin]?.utxoAccount, { slip44: 57, xpub: 'public-account-0' });
  f.accounts[0] = { ...f.accounts[0]!, address: 'rotated-receive-address' };
  assert.equal(f.sessions.getAccount(origin)?.address, 'rotated-receive-address');
  f.accounts[0] = { ...f.accounts[0]!, xpub: 'different-wallet-account' };
  assert.equal(f.sessions.getAccount(origin), null);
  assert.equal(f.sessions.isConnected(origin), false);
});

test('permission revocation closes the live grant before its durable write completes', async () => {
  const f = fixture();
  await f.sessions.connect(f.grant, f.context());
  let release!: () => void;
  f.setBeforeWrite(() => new Promise<void>((resolve) => { release = resolve; }));
  const revoke = f.sessions.revoke(origin, { allowAlreadyDisconnected: false });
  assert.equal(f.sessions.isConnected(origin), false);
  await settle();
  release();
  await revoke;
  assert.deepEqual(f.stored().dapps, {});
});
