#!/usr/bin/env node
/* Reproduce packaged Classic witness code/data from immutable upstream sources.
 * Usage: node scripts/generate-privacy-prover.cjs --source-root /path/to/classic-prover
 * Without --source-root, downloads pinned public build inputs into an OS temp directory.
 * This build-time script never runs in the wallet. It does not create a trusted setup.
 */
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const {
  suspendSignalWrites,
  trampolineWitnessRuntime,
} = require('./privacy-prover-adaptations.cjs');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'source/scripts/privacyProver');
const REFS = {
  snarkjs: '869181cfaf7526fe8972073d31655493a04326d5',
  websnark: '4c0af6a8b65aabea3c09f377f63c44e7a58afa6d',
  cli: '378ddf8b8b92a4924037d7b64a94dbfd5a7dd6e8',
};
const PIN = {
  'tornado.json':
    '3ddd61dbff09caeec82d8edde95c674a3c34f9e66b1fe9f2c8783e72fe536f98',
  'withdraw_verification_key.json':
    '3eedcf6ec6b5c24219ed19c7a33966fbfa6a03ae7c84124270589091e87cf8d3',
};
const SOURCE_PIN = {
  'artifacts/tornado.json':
    '3ddd61dbff09caeec82d8edde95c674a3c34f9e66b1fe9f2c8783e72fe536f98',
  'artifacts/withdraw_verification_key.json':
    '3eedcf6ec6b5c24219ed19c7a33966fbfa6a03ae7c84124270589091e87cf8d3',
  'vendor/snarkjs/src/bigint.js':
    'ed536201cd51de513a43c1732867d7f85456a178e4c124d5aa77d5aa82105f20',
  'vendor/snarkjs/src/calculateWitness.js':
    '0239f6419dcf04fa09dd7140c534899c140d804f7b20d5a0918649103800d932',
  'vendor/snarkjs/src/stringifybigint.js':
    '3c9812d0ab408321f0fc4b525b5fbb34198cbe2c59e9ae0be9eac2432e40c528',
  'vendor/snarkjs/src/verifier_groth.js':
    'c116321f0391dd1855b761fd278775053d11bf734d407b7818a158313b947c21',
  'vendor/snarkjs/src/bn128.js':
    '85c5519d4a590434c6e5e81ef5d78ae951f2dbf572c8d1df096ffeaa3373c1ef',
  'vendor/snarkjs/src/zqfield.js':
    '120352eaccd8d0c4578a9ced552c84c399f5b62b1b70a8861c7e9e8713616d6d',
  'vendor/snarkjs/src/f2field.js':
    'ec3bc96b0349b11c86f4b684bedd32df25be928dd1c0ca616a44a71dd26e4e7d',
  'vendor/snarkjs/src/f3field.js':
    '8f972e203762ab7f2c988a4e3615faf40e7b1b92c4cdec36f6388bc69b026a62',
  'vendor/snarkjs/src/gcurve.js':
    'acadaa8b446de36b8a7c41f2daea55e499a94f136b2a4fd241df9fdf38fc6fb8',
  'vendor/snarkjs/src/futils.js':
    '5f764b866aac6634a398648e6a5b9520976164a7afd865df16dacfaa5afa46d0',
  'vendor/websnark/src/groth16.js':
    '715466cd17ee6f096e2cf052dfbd2ffde77de10a95d8e0c1ea8b942b362bd932',
  'vendor/websnark/build/groth16_wasm.js':
    'f3dfe57eeb393d1a07794c1e710805e748064345f5f4ad2fb594a7882aa47d3c',
  'vendor/snarkjs/COPYING':
    '589ed823e9a84c56feb95ac58e7cf384626b9cbf4fda2a907bc36e103de1bad2',
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const flag = process.argv.indexOf('--source-root');
let sourceRoot;
const sources = [];
async function input(relative, url, expected) {
  let b;
  const local = path.join(sourceRoot, relative);
  try {
    b = await fs.readFile(local);
  } catch {
    if (flag !== -1) throw Error(`Missing pinned source: ${relative}`);
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw Error(`Source HTTP ${response.status}: ${relative}`);
    b = Buffer.from(await response.arrayBuffer());
    if (b.length > 25 * 1024 * 1024)
      throw Error('Source exceeds build input limit');
    await fs.mkdir(path.dirname(local), { recursive: true });
    await fs.writeFile(local, b);
  }
  expected = expected || SOURCE_PIN[relative];
  if (!expected || sha(b) !== expected)
    throw Error(`Pin mismatch: ${relative}`);
  sources.push({ file: relative, url, sha256: sha(b), bytes: b.length });
  return b;
}
async function save(relative, value) {
  const file = path.join(OUT, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value);
}
(async () => {
  sourceRoot =
    flag === -1
      ? await fs.mkdtemp(path.join(os.tmpdir(), 'pali-classic-build-'))
      : path.resolve(process.argv[flag + 1]);
  const circuit = JSON.parse(
    await input(
      'artifacts/tornado.json',
      `https://raw.githubusercontent.com/tornadocash/tornado-cli/${REFS.cli}/build/circuits/tornado.json`,
      PIN['tornado.json']
    )
  );
  const vk = await input(
    'artifacts/withdraw_verification_key.json',
    'https://github.com/tornadocash/tornado-core/releases/download/v2.1/withdraw_verification_key.json',
    PIN['withdraw_verification_key.json']
  );
  const metadata = {
    nInputs: circuit.nInputs,
    nOutputs: circuit.nOutputs,
    nVars: circuit.nVars,
    nSignals: circuit.nSignals,
    nPubInputs: circuit.nPubInputs,
    nPrvInputs: circuit.nPrvInputs,
    signalName2Idx: circuit.signalName2Idx,
    components: circuit.components,
    signals: circuit.signals.map((s) => ({
      triggerComponents: s.triggerComponents,
    })),
  };
  const packed = zlib.gzipSync(Buffer.from(JSON.stringify(metadata)), {
    level: 9,
  });
  await save('assets/metadata.json.gz', packed);
  await save('assets/verification-key.json', vk);
  const snarkFiles = [
    'bigint.js',
    'calculateWitness.js',
    'stringifybigint.js',
    'verifier_groth.js',
    'bn128.js',
    'zqfield.js',
    'f2field.js',
    'f3field.js',
    'gcurve.js',
    'futils.js',
  ];
  for (const file of snarkFiles) {
    let text = (
      await input(
        `vendor/snarkjs/src/${file}`,
        `https://raw.githubusercontent.com/tornadocash/snarkjs/${REFS.snarkjs}/src/${file}`
      )
    ).toString();
    if (file === 'calculateWitness.js') text = trampolineWitnessRuntime(text);
    // Only Web Crypto is available in these packaged dedicated workers.
    if (file === 'zqfield.js')
      text = text.replace(
        'return module.require("crypto").randomBytes(1)[0];',
        'throw new Error("Web Crypto unavailable");'
      );
    await save(`vendor/${file}`, text);
  }
  const functions =
    `/* Generated at build time from Classic circuit; GPL-3.0-or-later. See LICENSES.md. */\n` +
    `const bigInt=require('./vendor/bigint.js');\nconst calculateWitness=require('./vendor/calculateWitness.js');\nconst {unstringifyBigInts}=require('./vendor/stringifybigint.js');\n` +
    `const __P__=bigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');\nconst __MASK__=bigInt('28948022309329048855892746252171976963317496166410141009864396001978282409983');\n` +
    `const templates={${Object.entries(circuit.templates)
      .map(([k, v]) => `${JSON.stringify(k)}:(${suspendSignalWrites(v)})`)
      .join(',\n')}};\n` +
    `const functions={${Object.entries(circuit.functions)
      .map(
        ([k, v]) =>
          `${JSON.stringify(k)}:{params:${JSON.stringify(
            v.params
          )},func:(${suspendSignalWrites(v.func, false)})}`
      )
      .join(',\n')}};\n` +
    `module.exports=function(metadata){return Object.assign(unstringifyBigInts(metadata),{templates,functions,getSignalIdx(name){const i=this.signalName2Idx[name];if(i!==undefined)return i;if(!isNaN(name))return Number(name);throw Error('privacy_proof_invalid_input');},inputIdx(i){if(i>=this.nInputs)throw Error('privacy_proof_invalid_input');return this.nOutputs+1+i;},signalNames(i){return String(i);},calculateWitness(input){return calculateWitness(this,input,{logFunction:()=>undefined});}});};\n`;
  await save('witnessFactory.js', functions);
  let groth = (
    await input(
      'vendor/websnark/src/groth16.js',
      `https://raw.githubusercontent.com/tornadocash/websnark/${REFS.websnark}/src/groth16.js`
    )
  ).toString();
  const wasmSource = (
    await input(
      'vendor/websnark/build/groth16_wasm.js',
      `https://raw.githubusercontent.com/tornadocash/websnark/${REFS.websnark}/build/groth16_wasm.js`
    )
  ).toString();
  const wasm = Buffer.from(
    wasmSource.match(/new Buffer\("([A-Za-z0-9+/=]+)", "base64"\)/)[1],
    'base64'
  );
  await save('assets/groth16.wasm', wasm);
  const begin = groth.indexOf('function thread(self) {'),
    end = groth.indexOf('// We use the Object.assign', begin);
  const thread = groth
    .slice(begin, end)
    .replace(
      'function thread(self)',
      'module.exports = function installThread(self)'
    )
    .replace('process.exit();', 'self.close();');
  await save(
    'subworkerRuntime.js',
    groth.slice(0, groth.indexOf('/* globals')) + thread
  );
  groth = groth.slice(0, begin) + groth.slice(end);
  const head = groth.indexOf('const groth16_wasm');
  const afterHead = groth.indexOf('class Deferred', head);
  groth =
    groth.slice(0, head) +
    `const assert = (value) => { if (!value) throw Error('privacy_proof_worker_failed'); };\n` +
    groth.slice(afterHead);
  groth = groth.replace(
    'const defaultParams = { wasmInitialMemory: 5000 };',
    `const defaultParams = { wasmInitialMemory: 1000 };\n    const groth16_wasm = {code:params.wasmCode,pq:1000,pr:1768};`
  );
  const c0 = groth.indexOf('    let concurrency;'),
    c1 = groth.indexOf('    function getOnMsg', c0);
  groth =
    groth.slice(0, c0) +
    '    const concurrency = params.workerCount;\n    if (concurrency !== 2) throw Error("privacy_proof_worker_failed");\n' +
    groth.slice(c1);
  const w0 = groth.indexOf('        if (inBrowser) {'),
    w1 = groth.indexOf('        groth16.working[i]=false;', w0);
  groth =
    groth.slice(0, w0) +
    '        groth16.workers[i] = params.createWorker();\n        groth16.workers[i].onmessage = getOnMsg(i);\n' +
    groth.slice(w1);
  const r0 = groth.indexOf('        if (inBrowser) {'),
    r1 = groth.indexOf('        /// Uncoment', r0);
  groth =
    groth.slice(0, r0) +
    '        globalThis.crypto.getRandomValues(rnd);\n        this.putBin(pr, rnd);\n        globalThis.crypto.getRandomValues(rnd);\n        this.putBin(ps, rnd);\n' +
    groth.slice(r1);
  groth = groth.replace(
    'this.workers[i].postMessage({command: "TERMINATE"});',
    'this.workers[i].terminate();'
  );
  if (
    /\beval\s*\(|new\s+Function\s*\(|new Blob|thread\.toString|NodeWorker|inBrowser/.test(
      groth + functions + thread
    )
  )
    throw Error('Dynamic execution remained');
  await save('groth16Runtime.js', groth);
  const license = await input(
    'vendor/snarkjs/COPYING',
    `https://raw.githubusercontent.com/tornadocash/snarkjs/${REFS.snarkjs}/COPYING`
  );
  await save('COPYING', license);
  await save(
    'LICENSES.md',
    `# Classic prover source notices\n\nVendored snarkjs and websnark code and generated witness functions are GPL-3.0-or-later, copyright 2018/2019 0KIMS association. Full license: COPYING. Original headers are retained.\n\nSources: tornadocash/snarkjs@${REFS.snarkjs}, tornadocash/websnark@${REFS.websnark}, tornadocash/tornado-cli@${REFS.cli}.\n\nLocal adaptations: compile witness function strings into packaged JavaScript; omit unused debug metadata; compile standalone template signal writes as generator suspension points and execute components with an explicit depth-first frame stack preserving trigger order and scopes; use static MessagePort workers and Web Crypto; replace thread termination with host-owned termination. Public circuit/key assets retain their upstream project licensing. No trusted setup is generated or replaced.\n`
  );
  const manifest = {
    version: 1,
    sources,
    artifacts: {
      metadata: {
        bytes: packed.length,
        sha256: sha(packed),
        decodedBytes: Buffer.byteLength(JSON.stringify(metadata)),
      },
      wasm: { bytes: wasm.length, sha256: sha(wasm) },
      verificationKey: { bytes: vk.length, sha256: sha(vk) },
    },
    provingKey: {
      bytes: 14522256,
      sha256:
        '8e2d2f22beafb5a9666daebca57b13f8029c3656c65fcfbcc86e2418fa16a3af',
    },
  };
  await save('assets/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ generated: OUT, assets: manifest.artifacts }));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
