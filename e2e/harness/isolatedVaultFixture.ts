import { HDNodeWallet } from 'ethers';
import { utils as sys } from 'syscoinjs-lib';

import { createSptFixture, sptFixtureRead } from './sptFixture';
import { UTXO_FIXTURE_SEED } from './utxoFixture';
import type { BrowserContext } from '@playwright/test';

// Entirely synthetic read data. These are not observed balances or live assets.
export function createIsolatedVaultFixture() {
  const utxo = createSptFixture();
  const hd = new sys.HDSigner(UTXO_FIXTURE_SEED, '', true);
  hd.createAccountAtIndex(1, 84);
  const key = hd.deriveKeypair("m/84'/1'/1'/0/0");
  const secondAddress = sys.bitcoinjs.payments.p2wpkh({
    pubkey: key.publicKey,
    network: sys.syscoinNetworks.testnet,
  }).address!;
  return {
    utxo,
    secondUtxo: { address: secondAddress, xpub: hd.getAccountXpub() },
    watchAddress: utxo.recipientAddress,
    evmAddresses: [0, 1].map(
      (index) =>
        HDNodeWallet.fromPhrase(
          UTXO_FIXTURE_SEED,
          undefined,
          `m/44'/60'/0'/0/${index}`
        ).address
    ),
  };
}

type Fixture = ReturnType<typeof createIsolatedVaultFixture>;

function emptyUtxoRead(fixture: Fixture, text: string, method: string) {
  const url = new URL(text);
  if (
    method !== 'GET' ||
    ![
      'https://blockbook-dev.syscoin.org',
      'https://explorer-blockbook-dev.syscoin.org',
    ].includes(url.origin)
  )
    return undefined;
  const match = url.pathname.match(/^\/api\/v2\/(xpub|address|utxo)\/(.+)$/);
  if (!match) return undefined;
  const identifier = decodeURIComponent(match[2]);
  if (
    ![
      fixture.secondUtxo.address,
      fixture.secondUtxo.xpub,
      fixture.watchAddress,
    ].includes(identifier)
  )
    return undefined;
  if (match[1] === 'utxo') return [];
  return {
    address: identifier,
    balance: '0',
    unconfirmedBalance: '0',
    totalReceived: '0',
    totalSent: '0',
    txs: 0,
    unconfirmedTxs: 0,
    usedTokens: 0,
    tokens: [],
    tokensAsset: [],
  };
}

function evmResult(method: string): unknown | undefined {
  switch (method) {
    case 'eth_chainId':
      return '0x1644';
    case 'net_version':
      return '5700';
    case 'eth_blockNumber':
      return '0x1';
    case 'eth_getBalance':
    case 'eth_getTransactionCount':
      return '0x0';
    case 'eth_gasPrice':
    case 'eth_maxPriorityFeePerGas':
      return '0x3b9aca00';
    case 'eth_getCode':
    case 'eth_call':
      return '0x';
    case 'eth_getLogs':
      return [];
    case 'eth_getBlockByNumber':
      return {
        number: '0x1',
        hash: '0x' + '12'.repeat(32),
        parentHash: '0x' + '11'.repeat(32),
        nonce: '0x0000000000000000',
        timestamp: '0x1',
        difficulty: '0x0',
        gasLimit: '0x1c9c380',
        gasUsed: '0x0',
        miner: '0x' + '00'.repeat(20),
        extraData: '0x',
        transactions: [],
        baseFeePerGas: '0x3b9aca00',
      };
    default:
      return undefined;
  }
}

export async function installIsolatedVaultRoutes(
  context: BrowserContext,
  fixture: Fixture,
  localOrigin: string,
  resolveGet?: (url: URL) => unknown | undefined
) {
  const reads: string[] = [],
    deniedWrites: string[] = [];
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (
      url.origin === localOrigin &&
      url.pathname === '/' &&
      request.method() === 'GET'
    )
      return route.continue();
    let rpc: any;
    try {
      rpc = request.postDataJSON();
    } catch {
      /* ordinary REST */
    }
    const calls = Array.isArray(rpc) ? rpc : [rpc];
    const isWrite =
      /\/sendtx(?:\/|$)/i.test(url.pathname) ||
      calls.some((call) =>
        /^(?:eth_send|sendrawtransaction|sys_sign|wallet_sendCalls)/i.test(
          call?.method || ''
        )
      );
    if (isWrite) deniedWrites.push('attempted-write');
    // Install exact auxiliary GET replies with this first deny handler so
    // startup reads cannot race a later, separately registered route.
    let body: unknown =
      !isWrite && request.method() === 'GET' ? resolveGet?.(url) : undefined;
    if (body !== undefined) {
      reads.push('synthetic-get:' + url.href);
    } else if (
      request.method() === 'POST' &&
      url.origin === 'https://rpc.tanenbaum.io' &&
      url.pathname === '/'
    ) {
      const replies = calls.map((call) => {
        if (!call || call.jsonrpc !== '2.0' || !Array.isArray(call.params))
          return undefined;
        const result = evmResult(call.method);
        if (result === undefined) return undefined;
        return { jsonrpc: '2.0', id: call.id, result };
      });
      if (replies.length && replies.every((reply) => reply !== undefined)) {
        body = Array.isArray(rpc) ? replies : replies[0];
        reads.push(...calls.map((call) => 'synthetic-evm:' + call.method));
      }
    } else {
      body =
        sptFixtureRead(fixture.utxo, request.url(), request.method()) ??
        emptyUtxoRead(fixture, request.url(), request.method());
      if (body !== undefined)
        reads.push(
          'synthetic-blockbook:' + url.pathname.split('/').slice(0, 4).join('/')
        );
    }
    if (body === undefined) return route.abort('blockedbyclient');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
  return { reads, deniedWrites };
}
