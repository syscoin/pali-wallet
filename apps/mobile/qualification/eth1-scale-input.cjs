const { createHash } = require('node:crypto');
const { closeSync, constants, fstatSync, openSync, readSync } = require('node:fs');
const { Buffer } = require('node:buffer');
const { getMerkleZero, hashPair, TREE_DEPTH } = require('../../../source/utils/privacy/merkle.ts');
const { readPrivacyPoolSnapshot } = require('../../../source/utils/privacy/publicSyncProtocol.ts');
const { PUBLIC_POOL_ADDRESS, PUBLIC_POOL_ANCHOR_READS, PUBLIC_POOL_ID, PUBLIC_POOL_PATH } = require('./public-pool-contract.ts');

const ETH1_SCALE = Object.freeze({
  bytes: 13_113_982,
  sha256: 'c781e937602f0e0e2418ea0b403410bec58e59b3e2beb5ce4a399c0f0bc3676b',
  block: 26_352_958,
  blockHash: '0x1eb01697a380c08679f1b03e634b044e5765eef334e3703ded6a79002a1734b1',
  root: '0x272882aa78148f62d6490051a5b3740408affed64b1ffa41bc703321ddfc8430',
  leaves: 97_135,
  withdrawals: 92_918,
  batches: 759,
  pathDigests: Object.freeze([
    '0xe535b539b74dce3df03ec94ac7c043bb1b1b504c89512b39d45433d9b312b6e7',
    '0x28aa8817a4a4f1b976e5ac8586ad1e5edb1d1ce22fbbffcd5e04ceb8ef34676e',
  ]),
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const word = (value) => '0x' + BigInt(value).toString(16).padStart(64, '0');
const invalid = (kind) => new Error(`ETH1_SCALE_${kind}_INVALID`);
const exact = (value, keys) => value && typeof value === 'object' &&
  Object.keys(value).sort().join(',') === keys;

/** Bounded file admission with no stat/open replacement or unbounded growing read. */
function readFileBounded(file, maxBytes, kind, size) {
  if (typeof file !== 'string' || file.length === 0) throw invalid(kind);
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes ||
        (size !== undefined && stat.size !== size)) throw invalid(kind);
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) throw invalid(kind);
      offset += count;
    }
    if (fstatSync(fd).size !== bytes.length) throw invalid(kind);
    return bytes;
  } catch {
    throw invalid(kind);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Fixed shape and independently supplied responses, never inferred from the snapshot body. */
function readEth1ScaleTranscript(file) {
  const bytes = readFileBounded(file, 8192, 'TRANSCRIPT');
  let transcript;
  try {
    transcript = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw invalid('TRANSCRIPT'); }
  if (!exact(transcript, 'passes,version') || transcript.version !== 1 ||
      !Array.isArray(transcript.passes) || transcript.passes.length !== 2)
    throw invalid('TRANSCRIPT');
  const ids = new Set();
  const blockTag = '0x' + ETH1_SCALE.block.toString(16);
  const expected = ['0x1', null, word(ETH1_SCALE.leaves), ETH1_SCALE.root,
    word(TREE_DEPTH), word(10n ** 18n), null, word(1)];
  let timestamp;
  const passes = transcript.passes.map((pass) => {
    if (!Array.isArray(pass) || pass.length !== expected.length) throw invalid('TRANSCRIPT');
    return Object.freeze(pass.map((reply, index) => {
      if (!exact(reply, 'id,jsonrpc,read,result') || reply.jsonrpc !== '2.0' ||
          reply.read !== PUBLIC_POOL_ANCHOR_READS[index] ||
          !Number.isSafeInteger(reply.id) || reply.id < 1 || ids.has(reply.id))
        throw invalid('TRANSCRIPT');
      ids.add(reply.id);
      const { result } = reply;
      if (expected[index] !== null) {
        if (result !== expected[index]) throw invalid('TRANSCRIPT');
        return result;
      }
      if (!exact(result, 'hash,number,timestamp') || result.number !== blockTag ||
          result.hash !== ETH1_SCALE.blockHash ||
          typeof result.timestamp !== 'string' || !/^0x[1-9a-f][0-9a-f]{0,9}$/.test(result.timestamp) ||
          (timestamp !== undefined && timestamp !== result.timestamp))
        throw invalid('TRANSCRIPT');
      timestamp = result.timestamp;
      return Object.freeze({ ...result });
    }));
  });
  const blockTimestampMs = Number(BigInt(timestamp)) * 1000;
  if (blockTimestampMs > Date.parse('2026-11-06T03:14:36Z'))
    throw invalid('TRANSCRIPT');
  return Object.freeze({ sha256: sha256(bytes), blockTimestampMs, passes: Object.freeze(passes) });
}

async function readEth1ScaleSnapshot(file) {
  const bytes = readFileBounded(file, ETH1_SCALE.bytes, 'SNAPSHOT', ETH1_SCALE.bytes);
  if (sha256(bytes) !== ETH1_SCALE.sha256) throw invalid('SNAPSHOT');
  const origin = 'http://127.0.0.1:1';
  const signal = new AbortController().signal;
  const snapshot = await readPrivacyPoolSnapshot(PUBLIC_POOL_ID, signal, async (url, init, limit, read) => {
    if (url !== origin + PUBLIC_POOL_PATH || init.signal !== signal) throw invalid('SNAPSHOT');
    const response = new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
    return { status: 200, data: await read(response, Math.min(limit(response), ETH1_SCALE.bytes)) };
  }, origin);
  if (snapshot.poolAddress !== PUBLIC_POOL_ADDRESS || snapshot.asOfBlockNumber !== ETH1_SCALE.block ||
      snapshot.asOfBlockHash !== ETH1_SCALE.blockHash || snapshot.root !== ETH1_SCALE.root ||
      snapshot.leafCount !== ETH1_SCALE.leaves || snapshot.withdrawnNullifiers.length !== ETH1_SCALE.withdrawals)
    throw invalid('SNAPSHOT');
  return { bytes, snapshot };
}

/** Bottom-up reference uses the shared MiMC primitive, independent of the app's frontier/path index. */
function referencePaths(leaves) {
  let layer = leaves;
  const indexes = [0, leaves.length - 1];
  const paths = indexes.map(() => []);
  for (let depth = 0; depth < TREE_DEPTH; depth++) {
    const empty = getMerkleZero(depth);
    for (let path = 0; path < paths.length; path++) {
      paths[path].push(layer[indexes[path] ^ 1] ?? empty);
      indexes[path] = Math.floor(indexes[path] / 2);
    }
    const next = new Array(Math.ceil(layer.length / 2));
    for (let index = 0; index < next.length; index++)
      next[index] = hashPair(layer[index * 2], layer[index * 2 + 1] ?? empty);
    layer = next;
  }
  return Object.freeze({
    root: layer[0],
    pathDigests: Object.freeze(paths.map((path) => '0x' + sha256(path.join('')))),
  });
}

module.exports = { ETH1_SCALE, readEth1ScaleSnapshot, readEth1ScaleTranscript, referencePaths };
