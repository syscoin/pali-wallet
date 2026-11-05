import { ActivityExplorerReader } from '../src/activity/explorerReader.ts';
import { ActivityReceiptReader } from '../src/activity/receiptReader.ts';
import { createActivityScope } from '../src/activity/types.ts';
import type { EvmActivityReaders } from '../src/activity/nativeActivity.ts';
import {
  createUtxoActivityReader,
  type UtxoActivityReader,
} from '../src/core/utxoActivity.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createPublicAccountStorage } from '../src/core/publicAccountStorage.ts';
import { createBalanceReader } from '../src/platformRpc.ts';
import {
  createNativeHttpFetch,
  type WalletHttpFetch,
} from '../src/platform/httpPolicy.ts';
import { createUtxoBalanceReader } from '../src/core/utxoBalanceReader.ts';
import {
  createWatchAccount,
  getWatchNetworks,
  WatchOnlyAuthority,
  type BalanceReader,
} from '../src/core/watchOnlyAuthority.ts';
import {
  getUtxoNetwork,
  type UtxoNetworkId,
} from '../src/core/utxoNetworks.ts';
import {
  NATIVE_NETWORKS,
  nativeSigningEnabled,
} from '../src/custody/networkContext.ts';

const addresses = {
  syscoin: 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58',
  bitcoin: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
};
function evaluate(path: string, dependencies: Record<string, unknown>) {
  const module = { exports: {} as Record<string, unknown> };
  const source = readFileSync(new NodeURL(path, import.meta.url), 'utf8');
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      module,
      exports: module.exports,
      require(name: string) {
        assert.ok(
          Object.hasOwn(dependencies, name),
          `Unexpected platform import: ${name}`
        );
        return dependencies[name];
      },
      fetch() {
        assert.fail('Ambient fetch must not be used by the native platform');
      },
    }
  );
  return module.exports;
}
function platformExports(transport: WalletHttpFetch) {
  const http = evaluate('../src/platform/http.native.ts', {
    'expo/fetch': { fetch: transport },
    './httpPolicy.ts': { createNativeHttpFetch },
  });
  return evaluate('../src/platform.ts', {
    'react-native': { Platform: { OS: 'android' } },
    'expo-secure-store': {},
    './core/publicAccountStorage.ts': { createPublicAccountStorage },
    './platformRpc.ts': { createBalanceReader },
    './activity/explorerReader.ts': { ActivityExplorerReader },
    './activity/receiptReader.ts': { ActivityReceiptReader },
    './core/utxoBalanceReader.ts': { createUtxoBalanceReader },
    './core/utxoActivity.ts': { createUtxoActivityReader },
    './platform/http': http,
  });
}
function platform(transport: WalletHttpFetch): BalanceReader {
  return platformExports(transport).balanceReader as BalanceReader;
}
function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}
function metadata(id: UtxoNetworkId) {
  const network = getUtxoNetwork(id);
  return {
    blockbook: {
      coin: network.blockbookCoin,
      network: network.symbol,
      decimals: 8,
      initialSync: false,
      inSync: true,
      inSyncMempool: true,
      bestHeight: 123,
    },
    backend: { chain: 'main' },
  };
}

for (const id of ['syscoin', 'bitcoin'] as const) {
  test(`native public platform routes ${id} through owned HTTP with exact identity and no signing`, async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const network = getUtxoNetwork(id);
    const reader = platform(async (url, init) => {
      calls.push({ url, init });
      if (url === `${network.endpoint}/api/`) return json(metadata(id));
      if (url === `${network.endpoint}/api/v2/block-index/0`)
        return json({ blockHash: network.genesisHash });
      assert.equal(
        url,
        `${network.endpoint}/api/v2/address/${addresses[id]}?details=tokenBalances&tokens=nonzero`
      );
      return json({
        address: addresses[id],
        balance: '0',
        unconfirmedBalance: '-123',
        unconfirmedTxs: 1,
      });
    });
    const account = createWatchAccount(id, id, addresses[id], id);
    assert.deepEqual(
      getWatchNetworks(account).map((n) => n.id),
      [id]
    );
    const authority = new WatchOnlyAuthority([account], reader, () => 1);
    authority.unlock();
    await authority.refresh();
    assert.deepEqual(authority.getSnapshot().balance, {
      status: 'available',
      kind: 'utxo',
      units: '0',
      updatedAt: 1,
      pendingDeltaUnits: '-123',
      unconfirmedTransactions: 1,
      observedHeight: 123,
    });
    assert.equal(authority.getSnapshot().capabilities.send, false);
    await assert.rejects(
      authority.prepareTransfer({ recipient: addresses[id], amount: '1' }),
      /SIGNING_UNAVAILABLE/
    );
    assert.equal(calls.length, 3);
    for (const { init } of calls) {
      assert.equal(init.redirect, 'error');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.cache, undefined);
      assert.equal(
        new Headers(init.headers).get('Cache-Control'),
        'no-store, no-cache'
      );
      assert.equal(
        init.signal?.aborted,
        true,
        'Owned native request listeners must be released on completion'
      );
    }
    assert.equal(
      NATIVE_NETWORKS.some((n) => String(n.id) === id),
      false
    );
    assert.equal(nativeSigningEnabled(id), false);
  });
}

test('combined native platform retains the Ethereum RPC path and caller signal', async () => {
  const methods: string[] = [];
  const caller = new AbortController();
  const reader = platform(async (_url, init) => {
    assert.equal(init.method, 'POST');
    const body = JSON.parse(String(init.body));
    methods.push(body.method);
    return json({
      jsonrpc: '2.0',
      id: body.id,
      result: body.method === 'eth_chainId' ? '0x1' : '0x2a',
    });
  });
  assert.deepEqual(
    await reader.readBalance(
      'ethereum',
      '0x1111111111111111111111111111111111111111',
      caller.signal
    ),
    { chainId: 1, units: '42' }
  );
  assert.deepEqual(methods, ['eth_chainId', 'eth_getBalance']);
  assert.equal(caller.signal.aborted, false);
});

for (const failure of ['identity', 'redirect', 'malformed'] as const) {
  test(`native UTXO platform fails closed on ${failure}, without fallback or retained request signals`, async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const reader = platform(async (url, init) => {
      calls.push({ url, init });
      if (failure === 'redirect') throw Error('Native redirect refused');
      if (failure === 'malformed') return json({});
      return json(metadata('syscoin'));
    });
    const caller = new AbortController();
    await assert.rejects(
      reader.readUtxoBalance!('bitcoin', addresses.bitcoin, caller.signal)
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `${getUtxoNetwork('bitcoin').endpoint}/api/`);
    assert.equal(calls[0]!.init.signal?.aborted, true);
    assert.equal(caller.signal.aborted, false);
  });
}

test('native platform history uses the owned identified HTTP transport and actual account reader', async () => {
  const network = getUtxoNetwork('bitcoin'),
    calls: { url: string; init: RequestInit }[] = [];
  const exports = platformExports(async (url, init) => {
    calls.push({ url, init });
    if (url === `${network.endpoint}/api/`) return json(metadata('bitcoin'));
    if (url === `${network.endpoint}/api/v2/block-index/0`)
      return json({ blockHash: network.genesisHash });
    assert.equal(
      url,
      `${network.endpoint}/api/v2/address/${addresses.bitcoin}?details=txsummary&page=1&pageSize=20`
    );
    return json({
      address: addresses.bitcoin,
      txs: 0,
      unconfirmedTxs: 0,
      page: 1,
      totalPages: 1,
    });
  });
  const reader = exports.activityReader as UtxoActivityReader;
  const page = await reader.readPage(
    {
      context: {
        accountId: 'watch',
        networkId: 'bitcoin',
        address: addresses.bitcoin,
        generation: 1,
      },
      identifier: addresses.bitcoin,
      isAccount: false,
    },
    { page: 1 },
    new AbortController().signal
  );
  assert.deepEqual(page.rows, []);
  assert.equal(calls.length, 3);
  for (const { init } of calls) {
    assert.match(
      new Headers(init.headers).get('User-Agent') ?? '',
      /PaliWallet/
    );
    assert.equal(init.signal?.aborted, true);
    assert.equal(init.credentials, 'omit');
  }
});

test('native public EVM Activity binds the same identified transport to the selected explorer feed', async () => {
  const calls: { url: string; init: RequestInit; method: string }[] = [];
  const values = platformExports(async (url, init) => {
    const target = new URL(url);
    calls.push({ url, init, method: target.searchParams.get('action')! });
    assert.equal(init.body, undefined);
    return json({ status: '1', message: 'OK', result: [] });
  });
  const readers = values.evmActivityReaders as EvmActivityReaders;
  const scope = createActivityScope(
    'a'.repeat(64),
    'hd:60:0',
    '0x1111111111111111111111111111111111111111',
    'ethereum'
  );
  assert.deepEqual(
    await readers.explorer.page(
      scope,
      'txlist',
      1,
      new AbortController().signal,
      () => undefined
    ),
    []
  );
  assert.deepEqual(
    calls.map((call) => call.method),
    ['txlist']
  );
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, new URL(scope.apiUrl).origin);
    assert.match(
      new Headers(call.init.headers).get('User-Agent') ?? '',
      /PaliWallet/
    );
    assert.equal(call.init.credentials, 'omit');
  }
});
