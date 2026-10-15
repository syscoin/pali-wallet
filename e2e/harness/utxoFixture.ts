import * as ecc from '@bitcoinerlab/secp256k1';
import http from 'http';
import { utils as sys } from 'syscoinjs-lib';

import type { BrowserContext } from '@playwright/test';

// Public synthetic seed. Never use it on a public chain. No real UTXOs exist.
export const UTXO_FIXTURE_SEED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const UTXO_FIXTURE_PATH = "m/84'/1'/0'/0/0";
export const UTXO_SPONSOR_PATH = "m/84'/1'/1'/0/0";
const network = sys.syscoinNetworks.testnet;
const bitcoin = sys.bitcoinjs;
const BACKENDS = new Set([
  'https://explorer-blockbook-dev.syscoin.org',
  'https://blockbook-dev.syscoin.org',
]);

export function createUtxoFixture() {
  bitcoin.initEccLib(ecc);
  const hd = new sys.HDSigner(UTXO_FIXTURE_SEED, '', true);
  const user = hd.deriveKeypair(UTXO_FIXTURE_PATH);
  const sponsor = hd.deriveKeypair(UTXO_SPONSOR_PATH);
  const recipient = hd.deriveKeypair("m/84'/1'/2'/0/0");
  const payment = (key: any) =>
    bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network });
  const userPayment = payment(user),
    sponsorPayment = payment(sponsor),
    destination = payment(recipient);
  const parent = (script: Buffer, marker: number) => {
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, marker), 0);
    tx.addOutput(script, BigInt(100000));
    return tx;
  };
  const parents = [
    parent(userPayment.output!, 10),
    parent(sponsorPayment.output!, 11),
  ];
  const make = (mixed: boolean) => {
    const psbt = new bitcoin.Psbt({ network });
    psbt.addInput({
      hash: parents[0].getId(),
      index: 0,
      nonWitnessUtxo: parents[0].toBuffer(),
      witnessUtxo: parents[0].outs[0],
      bip32Derivation: [
        {
          masterFingerprint: hd.getMasterFingerprint(),
          path: UTXO_FIXTURE_PATH,
          pubkey: user.publicKey,
        },
      ],
    });
    if (mixed)
      psbt.addInput({
        hash: parents[1].getId(),
        index: 0,
        nonWitnessUtxo: parents[1].toBuffer(),
        witnessUtxo: parents[1].outs[0],
        // The same seed really can sign this account-1 input. Account-0 scope,
        // not missing derivation metadata, must keep the wallet from doing so.
        bip32Derivation: [
          {
            masterFingerprint: hd.getMasterFingerprint(),
            path: UTXO_SPONSOR_PATH,
            pubkey: sponsor.publicKey,
          },
        ],
      });
    psbt.addOutput({ address: destination.address!, value: BigInt(90000) });
    psbt.addOutput({
      address: userPayment.address!,
      value: BigInt(mixed ? 10000 : 9000),
    });
    if (mixed)
      psbt.addOutput({
        address: sponsorPayment.address!,
        value: BigInt(99000),
      });
    return psbt;
  };
  const single = make(false),
    mixed = make(true);
  return {
    userAddress: userPayment.address!,
    userXpub: hd.getAccountXpub(),
    recipientAddress: destination.address!,
    sponsorAddress: sponsorPayment.address!,
    parentTxs: parents,
    single: sys.exportPsbtToJson(single),
    mixed: sys.exportPsbtToJson(mixed),
    // Deliberately unscoped synthetic signer: offline counterfactual only.
    // Never used by the browser journey, which must go through normal Pali.
    signUserOffline: (psbt: any) => hd.sign(psbt),
    finishSponsor: (psbt: any) => {
      psbt.signInput(1, sponsor);
      psbt.finalizeInput(1);
      return psbt;
    },
  };
}

export type UtxoFixture = ReturnType<typeof createUtxoFixture>;
export const importFixturePsbt = (value: any) =>
  sys.importPsbtFromJson(value, network).psbt;
export const exportFixturePsbt = (value: any) => sys.exportPsbtToJson(value);

function unsignedHex(psbt: any): string {
  const tx = new bitcoin.Transaction();
  tx.version = psbt.version;
  tx.locktime = psbt.locktime;
  psbt.txInputs.forEach((input: any) =>
    tx.addInput(input.hash, input.index, input.sequence)
  );
  psbt.txOutputs.forEach((output: any) =>
    tx.addOutput(output.script, output.value)
  );
  return tx.toHex();
}

function witnessItems(bytes: Uint8Array): Buffer[] {
  const b = Buffer.from(bytes);
  let offset = 0;
  const small = () => {
    if (offset >= b.length || b[offset] >= 253)
      throw new Error('Unexpected fixture witness');
    return b[offset++];
  };
  const count = small(),
    items = [];
  for (let i = 0; i < count; i++) {
    const size = small();
    if (offset + size > b.length) throw new Error('Truncated fixture witness');
    items.push(b.subarray(offset, (offset += size)));
  }
  if (offset !== b.length) throw new Error('Trailing fixture witness');
  return items;
}

export function verifyFixtureSignature(
  fixture: UtxoFixture,
  value: any,
  mixed: boolean
) {
  const psbt = importFixturePsbt(value),
    expected = importFixturePsbt(mixed ? fixture.mixed : fixture.single);
  if (unsignedHex(psbt) !== unsignedHex(expected))
    throw new Error('Pali changed the unsigned transaction');
  const input = psbt.data.inputs[0];
  if (input.finalScriptSig?.length)
    throw new Error('Unexpected native user scriptSig');
  if (!input.finalScriptWitness)
    throw new Error('Pali did not finalize its input');
  const items = witnessItems(input.finalScriptWitness);
  if (items.length !== 2) throw new Error('Unexpected user witness item count');
  const [encoded, pubkey] = items;
  if (!encoded || !pubkey) throw new Error('Missing user signature');
  const decoded = bitcoin.script.signature.decode(encoded);
  if (decoded.hashType !== bitcoin.Transaction.SIGHASH_ALL)
    throw new Error('Unexpected sighash');
  const script = bitcoin.payments.p2pkh({ pubkey, network }).output!;
  const tx = bitcoin.Transaction.fromHex(unsignedHex(psbt));
  const digest = tx.hashForWitnessV0(
    0,
    script,
    BigInt(100000),
    decoded.hashType
  );
  if (!ecc.verify(digest, pubkey, decoded.signature))
    throw new Error('Invalid user witness');
  if (
    bitcoin.payments.p2wpkh({ pubkey, network }).address !== fixture.userAddress
  )
    throw new Error('Wrong user witness');
  if (mixed) {
    const external = psbt.data.inputs[1];
    if (
      external.finalScriptSig ||
      external.finalScriptWitness ||
      external.partialSig?.length ||
      external.tapKeySig ||
      external.tapScriptSig?.length
    ) {
      throw new Error('Pali signed the sponsor input');
    }
    const derivations = external.bip32Derivation;
    const expectedDerivations = expected.data.inputs[1].bip32Derivation;
    if (
      !expectedDerivations?.length ||
      !derivations ||
      derivations.length !== expectedDerivations.length ||
      derivations.some((entry: any, index: number) => {
        const original = expectedDerivations[index];
        return (
          entry.path !== original.path ||
          !Buffer.from(entry.masterFingerprint).equals(
            Buffer.from(original.masterFingerprint)
          ) ||
          !Buffer.from(entry.pubkey).equals(Buffer.from(original.pubkey))
        );
      })
    ) {
      throw new Error('Pali changed the sponsor derivation metadata');
    }
  }
  return psbt;
}

export function verifyCompletedSponsor(fixture: UtxoFixture, psbt: any) {
  const tx = psbt.extractTransaction();
  tx.ins.forEach((input: any, index: number) => {
    if (input.script.length !== 0)
      throw new Error('Unexpected completed native scriptSig');
    if (input.witness.length !== 2)
      throw new Error('Missing completed witness');
    const [encoded, pubkey] = input.witness,
      signature = bitcoin.script.signature.decode(encoded);
    const address = bitcoin.payments.p2wpkh({ pubkey, network }).address;
    if (
      address !==
        (index === 0 ? fixture.userAddress : fixture.sponsorAddress) ||
      signature.hashType !== 1 ||
      !ecc.verify(
        tx.hashForWitnessV0(
          index,
          bitcoin.payments.p2pkh({ pubkey, network }).output!,
          BigInt(100000),
          1
        ),
        pubkey,
        signature.signature
      )
    ) {
      throw new Error('Invalid completed sponsor witness');
    }
  });
  return tx.getId();
}

export function fixtureRead(
  fixture: UtxoFixture,
  requestUrl: string,
  method: string
): unknown | undefined {
  const url = new URL(requestUrl);
  if (method !== 'GET' || !BACKENDS.has(url.origin)) return undefined;
  const ownIdentifier = (prefix: string) => {
    if (!url.pathname.startsWith(prefix)) return false;
    const value = decodeURIComponent(url.pathname.slice(prefix.length));
    return value === fixture.userXpub || value === fixture.userAddress;
  };
  if (url.pathname === '/api/v2' || url.pathname === '/api/v2/')
    return {
      blockbook: { coin: 'Syscoin Testnet', inSync: true, bestHeight: 1 },
      backend: { chain: 'test', blocks: 1 },
    };
  if (ownIdentifier('/api/v2/xpub/') || ownIdentifier('/api/v2/address/'))
    return {
      address: decodeURIComponent(url.pathname.split('/').pop()!),
      balance: '100000',
      unconfirmedBalance: '0',
      totalReceived: '100000',
      totalSent: '0',
      txs: 0,
      unconfirmedTxs: 0,
      usedTokens: 1,
      tokens: [
        {
          type: 'XPUBAddress',
          name: fixture.userAddress,
          path: UTXO_FIXTURE_PATH,
          balance: '100000',
          totalReceived: '100000',
          totalSent: '0',
          transfers: 0,
        },
      ],
    };
  if (ownIdentifier('/api/v2/utxo/'))
    return [
      {
        txid: fixture.parentTxs[0].getId(),
        vout: 0,
        value: '100000',
        height: 1,
        confirmations: 1,
        address: fixture.userAddress,
        path: UTXO_FIXTURE_PATH,
      },
    ];
  const tx = fixture.parentTxs.find(
    (row) => url.pathname === '/api/v2/tx/' + row.getId()
  );
  if (tx)
    return {
      txid: tx.getId(),
      hex: tx.toHex(),
      confirmations: 1,
      vin: [],
      vout: [],
    };
  if (/^\/api\/v2\/estimatefee\/\d+$/.test(url.pathname))
    return { result: '0.00001' };
  if (url.pathname === '/api/v2/tickers') return { ts: 1, rates: { usd: 1 } };
  return undefined;
}

const DAPP = `<!doctype html><title>Offline Pali UTXO fixture</title><h1>Offline Pali UTXO fixture</h1><script>
window.__paliConformance={requests:[]};
window.__paliConformanceProvider={request:async args=>{
 const row={id:window.__paliConformance.requests.length,method:args.method,params:args.params,started:Date.now()};
 window.__paliConformance.requests.push(row);
 try{return row.result=await window.pali.request(args);}catch(e){row.error={code:e.code,message:String(e.message)};throw e;}
 finally{row.settled=true;row.durationMs=Date.now()-row.started;}
}};</script>`;

// This server never forwards traffic: it also acts as the launch-time deny proxy.
export async function startUtxoFixtureServer() {
  const blocked: string[] = [];
  let origin = '';
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === origin + '/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DAPP);
    } else {
      blocked.push(req.method || 'unknown');
      res.writeHead(403);
      res.end('Offline fixture only');
    }
  });
  server.on('connect', (_req, socket) => {
    blocked.push('CONNECT');
    socket.on('error', (error: NodeJS.ErrnoException) => {
      // A denied client may reset before or after receiving the 403 response.
      if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE')
        server.emit('error', error);
      socket.destroy();
    });
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing fixture port');
  origin = 'http://127.0.0.1:' + address.port;
  return {
    url: origin,
    blocked,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

export async function installUtxoFixtureRoutes(
  context: BrowserContext,
  fixture: UtxoFixture,
  localOrigin: string
) {
  const deniedWrites: string[] = [],
    reads: string[] = [];
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return route.continue();
    if (
      url.origin === localOrigin &&
      request.method() === 'GET' &&
      url.pathname === '/'
    )
      return route.continue();
    let rpc: any;
    try {
      rpc = request.postDataJSON();
    } catch {
      /* REST or plain text. */
    }
    const calls = Array.isArray(rpc) ? rpc : [rpc];
    if (
      /\/sendtx(?:\/|$)/i.test(url.pathname) ||
      calls.some((row) =>
        /^(?:eth_send|sendrawtransaction|sys_signAndSend|wallet_sendCalls)/i.test(
          row?.method || ''
        )
      )
    )
      deniedWrites.push(url.pathname);
    const body = fixtureRead(fixture, request.url(), request.method());
    if (body === undefined) return route.abort('blockedbyclient');
    reads.push(url.pathname);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
  return { deniedWrites, reads };
}
