import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Interface } from 'ethers/abi';
import {
  createNativeWatchAssetObserver,
  prepareNativeWatchAsset,
} from '../src/portfolio/nativeWatchAsset.ts';
import {
  NativeTokenRegistry,
  NATIVE_TOKEN_REGISTRY_KEY,
  type NativeTokenScope,
} from '../src/portfolio/tokenRegistry.ts';
import type { NativeTokenRuntime } from '../src/portfolio/nativeTokens.ts';
import {
  getNativeNetwork,
  createNativeNetwork,
} from '../src/custody/networkContext.ts';
import type { NativeWalletCatalogueSnapshot } from '../src/custody/walletCatalogue.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';
import type { DappWatchAssetRequest } from '../../../source/shared/dappWalletControl.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  validPair,
} from './storageHelpers.ts';

const address = '0x1111111111111111111111111111111111111111';
const contract = '0x3333333333333333333333333333333333333333';
const owner = { accountId: 'hd:60:0', networkId: 'ethereum', address };
const abi = new Interface([
  'function supportsInterface(bytes4) view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
]);
const block = { number: '0x123', hash: '0x' + 'ab'.repeat(32) };

async function fixture(type: DappWatchAssetRequest['type'] = 'ERC721') {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-watch-asset-'));
  let beforeWrite: (() => void) | undefined;
  const storage = await SqliteWalletStorage.open(
    nodeConnection(path.join(directory, 'wallet.sqlite'), {
      before(kind, sql) {
        if (kind === 'run' && sql.startsWith('INSERT INTO keyring_records'))
          beforeWrite?.();
      },
    }).connection,
    digest,
    INSTALLATION,
    true
  );
  await storage.keyringStorage.createManyIfAbsent(validPair());
  const network = getNativeNetwork('ethereum');
  const scope: NativeTokenScope = {
    walletFingerprint: await storage.getWalletFingerprint(),
    accountId: owner.accountId,
    address,
    network: network.id,
    chainId: network.chainId,
    registrationHash: network.registrationHash,
  };
  const registry = new NativeTokenRegistry(storage.keyringStorage);
  let state: CustodySnapshot = {
    phase: 'ready',
    revision: 1,
    presence: 'existing',
    backup: 'confirmed',
    account: { address, network: network.id },
    error: null,
  };
  let catalogue: NativeWalletCatalogueSnapshot = {
    revision: 1,
    active: { accountId: owner.accountId, networkId: network.id },
    accounts: [
      {
        id: owner.accountId,
        address,
        type: 'HDAccount',
        index: 0,
        slip44: 60,
        label: 'Account',
      },
    ],
    networks: [network],
    utxoNetworks: [],
  };
  const runtime: NativeTokenRuntime = {
    load: (check) => registry.load(scope, check),
    add: (revision, metadata, check) =>
      registry.add(scope, revision, metadata, check),
    remove: (revision, target, check) =>
      registry.remove(scope, revision, target, check),
    addCollectible: (revision, item, check) =>
      registry.addCollectible(scope, revision, item, check),
  };
  let reportedType = type,
    symbol = 'OBSERVED',
    active = true;
  const calls: string[] = [];
  const observe = createNativeWatchAssetObserver({
    registrations: () => catalogue.networks,
    async fetch(url, init) {
      assert.equal(url, network.rpcUrl);
      const wire = JSON.parse(String(init.body));
      let result: unknown;
      if (wire.method === 'eth_chainId') result = '0x1';
      else if (wire.method === 'eth_getBlockByNumber') result = block;
      else if (wire.method === 'eth_getCode') result = '0x6000';
      else if (wire.method === 'eth_call') {
        const call = wire.params[0];
        assert.equal(call.to, contract);
        assert.equal(wire.params[1], block.number);
        const parsed = abi.parseTransaction(call)!;
        calls.push(parsed.name);
        if (parsed.name === 'supportsInterface')
          result = abi.encodeFunctionResult(parsed.name, [
            parsed.args[0] ===
              (reportedType === 'ERC721'
                ? '0x80ac58cd'
                : reportedType === 'ERC1155'
                ? '0xd9b67a26'
                : '0x00000000'),
          ]);
        else if (parsed.name === 'name')
          result = abi.encodeFunctionResult(parsed.name, [
            'Observed collection',
          ]);
        else if (parsed.name === 'symbol')
          result = abi.encodeFunctionResult(parsed.name, [symbol]);
        else if (parsed.name === 'decimals')
          result = abi.encodeFunctionResult(parsed.name, [18]);
        else if (parsed.name === 'balanceOf')
          result = abi.encodeFunctionResult(parsed.name, [0]);
        else assert.fail('Unexpected contract read');
      } else assert.fail('Unexpected RPC');
      return Response.json({ jsonrpc: '2.0', id: wire.id, result });
    },
  });
  const source = {
    getSnapshot: () => state,
    getCatalogue: () => catalogue,
    subscribe: () => () => undefined,
  };
  const check = () => {
    if (!active) throw new Error('REQUEST_EXPIRED');
  };
  const signal = new AbortController();
  const request: DappWatchAssetRequest = {
    method: 'wallet_watchAsset',
    type,
    address: contract,
    requestedSymbol: 'DAPP-CLAIM',
    ...(type === 'ERC1155' ? { tokenId: ((1n << 256n) - 1n).toString() } : {}),
  };
  const prepare = () =>
    prepareNativeWatchAsset(request, owner, signal.signal, check, {
      source,
      runtime: () => runtime,
      observe,
    });
  return {
    request,
    prepare,
    runtime,
    registry,
    scope,
    calls,
    storage,
    signal,
    check,
    setType: (value: typeof type) => {
      reportedType = value;
    },
    setSymbol: (value: string) => {
      symbol = value;
    },
    expire: () => {
      active = false;
    },
    changeAccount: () => {
      state = {
        ...state,
        revision: 2,
        account: {
          address: '0x2222222222222222222222222222222222222222',
          network: 'ethereum',
        },
      };
    },
    changeRegistration: () => {
      catalogue = {
        ...catalogue,
        networks: [
          createNativeNetwork({ ...network, rpcUrl: 'https://other.invalid' }),
        ],
      };
    },
    beforeWrite: (callback: () => void) => {
      beforeWrite = callback;
    },
    async close() {
      await storage.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

for (const type of ['ERC721', 'ERC1155', 'ERC20'] as const) {
  test(`${type} watchAsset observes the contract without requiring ownership and persists only after confirmation`, async (t) => {
    const f = await fixture(type);
    t.after(() => f.close());
    const prepared = await f.prepare();
    assert.equal(
      await f.storage.keyringStorage.get(NATIVE_TOKEN_REGISTRY_KEY),
      undefined
    );
    assert.equal(prepared.details.kind, 'watch-asset');
    assert.equal(
      'symbol' in prepared.details && prepared.details.symbol,
      'OBSERVED'
    );
    assert.equal('tokenId' in prepared.details, type === 'ERC1155');
    const result = await prepared.commit(f.check, () => assert.fail('Asset admission must not commit a network switch'));
    result.assertCurrent();
    assert.equal(result.result, true);
    const saved = await f.registry.load(f.scope, () => undefined);
    if (type === 'ERC20')
      assert.deepEqual(saved.items, [
        {
          contractAddress: contract,
          name: 'OBSERVED',
          symbol: 'OBSERVED',
          decimals: 18,
        },
      ]);
    else
      assert.deepEqual(saved.collectibles, [
        {
          contractAddress: contract,
          tokenStandard: type === 'ERC721' ? 'ERC-721' : 'ERC-1155',
          ...(type === 'ERC1155' ? { tokenId: f.request.tokenId } : {}),
        },
      ]);
    if (type !== 'ERC20')
      assert.equal(
        f.calls.some((name) => name === 'balanceOf' || name === 'ownerOf'),
        false
      );
    await assert.rejects(prepared.commit(f.check, () => assert.fail('Asset admission must not commit a network switch')), /CANCELLED/);
    prepared.dispose();
  });
}
test('wrong standard and changed metadata never authorize a saved collection', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  f.setType('ERC1155');
  await assert.rejects(f.prepare(), /INVALID_RESPONSE/);
  f.setType('ERC721');
  const prepared = await f.prepare();
  f.setSymbol('CHANGED');
  await assert.rejects(prepared.commit(f.check, () => assert.fail('Asset admission must not commit a network switch')), /metadata changed/);
  assert.equal(
    await f.storage.keyringStorage.get(NATIVE_TOKEN_REGISTRY_KEY),
    undefined
  );
  prepared.dispose();
});
for (const change of ['account', 'registration', 'request', 'abort'] as const) {
  test(`the prepared watch capability rejects a changed ${change}`, async (t) => {
    const f = await fixture();
    t.after(() => f.close());
    const prepared = await f.prepare();
    if (change === 'account') f.changeAccount();
    if (change === 'registration') f.changeRegistration();
    if (change === 'request') f.expire();
    if (change === 'abort') f.signal.abort();
    await assert.rejects(prepared.commit(f.check, () => assert.fail('Asset admission must not commit a network switch')));
    assert.equal(
      await f.storage.keyringStorage.get(NATIVE_TOKEN_REGISTRY_KEY),
      undefined
    );
    prepared.dispose();
  });
}
test('the original dapp guard reaches the real SQLite COMMIT boundary', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const prepared = await f.prepare();
  f.beforeWrite(f.expire);
  await assert.rejects(prepared.commit(f.check, () => assert.fail('Asset admission must not commit a network switch')));
  assert.equal(
    await f.storage.keyringStorage.get(NATIVE_TOKEN_REGISTRY_KEY),
    undefined
  );
  assert.equal(f.registry.requiresReopen, false);
  prepared.dispose();
});
test('a competing registry revision is preserved rather than overwritten', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const prepared = await f.prepare();
  const other = {
    contractAddress: '0x4444444444444444444444444444444444444444',
    name: 'Existing',
    symbol: 'OLD',
    decimals: 18,
  };
  await f.runtime.add(0, other, () => undefined);
  await assert.rejects(prepared.commit(f.check, () => assert.fail('Asset admission must not commit a network switch')), /CHANGED/);
  assert.deepEqual((await f.registry.load(f.scope, () => undefined)).items, [
    other,
  ]);
  prepared.dispose();
});
