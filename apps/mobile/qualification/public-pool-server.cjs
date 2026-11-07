const http = require('node:http');
const https = require('node:https');
const { Buffer } = require('node:buffer');
const { randomBytes, X509Certificate } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const {
  PUBLIC_POOL_ADDRESS, PUBLIC_POOL_ANCHOR_READS, PUBLIC_POOL_BATCHES, PUBLIC_POOL_BLOCK, PUBLIC_POOL_BLOCK_HASH,
  PUBLIC_POOL_LEAVES, PUBLIC_POOL_PATH, PUBLIC_POOL_PATH_DIGESTS, PUBLIC_POOL_ROOT, publicPoolAnchorPath,
} = require('./public-pool-contract.ts');

const local = '127.0.0.1';
const word = (value) => '0x' + BigInt(value).toString(16).padStart(64, '0');
const tag = '0x' + PUBLIC_POOL_BLOCK.toString(16);
const call = (data, at = tag) => ['eth_call', [{ to: PUBLIC_POOL_ADDRESS, data }, at]];
const forbiddenHeaders = ['cookie', 'authorization', 'referer', 'proxy-authorization', 'transfer-encoding', 'content-encoding'];
const readCalls = [
  ['eth_chainId', []], ['eth_getBlockByNumber', [tag, false]], call('0xfc7e9c6f'), call('0xba70f757'),
  call('0x4ecf518b'), call('0x8bca6d16'), ['eth_getBlockByNumber', [tag, false]],
  call('0x6d9833e3' + PUBLIC_POOL_ROOT.slice(2), 'latest'),
];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, local, () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
}

async function close(server) {
  if (!server.listening) return;
  const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections();
  return closed;
}

/** Strict local offline transcripts. Never consult the candidate bytes for RPC replies. */
async function createPublicPoolFixture({ key, cert }) {
  if (new X509Certificate(cert).checkIP(local) !== local) throw Error('PUBLIC_POOL_FIXTURE_TLS_SAN');
  const token = randomBytes(16).toString('hex');
  const block = { number: tag, hash: PUBLIC_POOL_BLOCK_HASH, timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) };
  const results = ['0x1', block, word(PUBLIC_POOL_LEAVES), PUBLIC_POOL_ROOT, word(20), word(10n ** 18n), block, word(1)];
  const snapshotBody = JSON.stringify({ version: 1, chainId: 1, poolAddress: PUBLIC_POOL_ADDRESS, asOfBlockNumber: PUBLIC_POOL_BLOCK,
    asOfBlockHash: PUBLIC_POOL_BLOCK_HASH, leafCount: PUBLIC_POOL_LEAVES, root: PUBLIC_POOL_ROOT,
    leaves: Array.from({ length: PUBLIC_POOL_LEAVES }, (_, index) => word(index + 1)), withdrawnNullifiers: [] });
  let gets = 0;
  let invalid = 0;
  let snapshotPort;
  let anchorPort;
  let pending = false;
  const requestIds = [];
  const failed = (response) => { ++invalid; response.writeHead(400, { Connection: 'close' }); response.end(); };
  const reply = (response, body) => {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    response.end(body);
  };
  const localRequest = (request, port) => request.headers.host === `${local}:${port}` &&
    request.headers['user-agent'] === 'PaliWallet' && request.headers['accept-encoding'] === 'identity' &&
    forbiddenHeaders.every((header) => request.headers[header] === undefined);
  const indexer = http.createServer((request, response) => {
    if (!localRequest(request, snapshotPort) || request.method !== 'GET' || request.url !== PUBLIC_POOL_PATH ||
        request.headers['content-length'] !== undefined || gets !== 0) { failed(response); return; }
    gets += 1;
    reply(response, snapshotBody);
  });
  const anchor = https.createServer({ key, cert, minVersion: 'TLSv1.2', handshakeTimeout: 5000 }, (request, response) => {
    const size = request.headers['content-length'];
    const offset = requestIds.length;
    if (!localRequest(request, anchorPort) || request.method !== 'POST' || request.url !== publicPoolAnchorPath(token) ||
        request.headers['content-type'] !== 'application/json' || typeof size !== 'string' || !/^[1-9][0-9]{0,2}$/.test(size) ||
        gets !== 1 || pending || offset >= PUBLIC_POOL_ANCHOR_READS.length * 2) { failed(response); return; }
    pending = true;
    let body = '';
    let count = 0;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      count += Buffer.byteLength(chunk);
      if (count > Number(size)) request.destroy();
      else body += chunk;
    });
    request.on('close', () => { pending = false; if (!request.complete) invalid++; });
    request.on('end', () => {
      const [method, params] = readCalls[offset % readCalls.length];
      let input;
      try { input = JSON.parse(body); } catch { failed(response); return; }
      if (!input || count !== Number(size) || Object.keys(input).sort().join(',') !== 'id,jsonrpc,method,params' ||
          input.jsonrpc !== '2.0' || !Number.isSafeInteger(input.id) || input.id <= 0 || requestIds.includes(input.id) ||
          input.method !== method || !isDeepStrictEqual(input.params, params)) { failed(response); return; }
      requestIds.push(input.id);
      reply(response, JSON.stringify({ jsonrpc: '2.0', id: input.id, result: results[offset % results.length] }));
    });
  });
  for (const server of [indexer, anchor]) {
    server.requestTimeout = 5_000;
    server.headersTimeout = 5_000;
    server.setTimeout(5000, (socket) => { ++invalid; socket.destroy(); });
    server.on('connect', (_request, socket) => { ++invalid; socket.destroy(); });
    server.on('upgrade', (_request, socket) => { ++invalid; socket.destroy(); });
  }
  try { snapshotPort = await listen(indexer); anchorPort = await listen(anchor); }
  catch (error) { await Promise.allSettled([close(indexer), close(anchor)]); throw error; }
  return {
    launch: Object.freeze({ snapshotPort, anchorPort, token }),
    assertComplete(value) {
      if (pending || invalid !== 0 || gets !== 1 || requestIds.length !== 16 || !value ||
          !isDeepStrictEqual(value, { root: PUBLIC_POOL_ROOT, block: PUBLIC_POOL_BLOCK, leaves: PUBLIC_POOL_LEAVES,
            batches: PUBLIC_POOL_BATCHES, pathDigests: PUBLIC_POOL_PATH_DIGESTS, requestIds, gets, anchorPasses: 2 }))
        throw Error('PUBLIC_POOL_FIXTURE_AUDIT_FAILED');
    },
    close: () => Promise.all([close(indexer), close(anchor)]),
  };
}
module.exports = { createPublicPoolFixture };
