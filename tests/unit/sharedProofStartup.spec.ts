import { execFileSync } from 'child_process';
import path from 'path';

it('imports the real wallet SDK without proof dependencies and loads them only for a proof request', () => {
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      String.raw`
        const assert = require('node:assert/strict');
        const Module = require('node:module');
        const http = require('node:http');
        const https = require('node:https');
        const net = require('node:net');
        const denyNetwork = () => { throw new Error('Unexpected network access'); };
        for (const target of [http, https]) {
          target.request = denyNetwork;
          target.get = denyNetwork;
        }
        net.connect = denyNetwork;
        net.createConnection = denyNetwork;
        global.fetch = denyNetwork;
        const proof = new Set(['eth-proof', 'eth-util-lite', 'eth-object']);
        const loads = [];
        const original = Module._load;
        Module._load = function(id) {
          if (proof.has(id)) {
            loads.push(id);
            throw new Error('Proof dependency requested');
          }
          return Reflect.apply(original, this, arguments);
        };
        (async () => {
          const fromRoot = Module.createRequire(process.cwd() + '/package.json');
          const sdk = fromRoot('@sidhujag/sysweb3-keyring');
          const software = fromRoot('@sidhujag/sysweb3-keyring/cjs/software');
          const library = fromRoot('syscoinjs-lib');
          assert.equal(typeof sdk.KeyringManager, 'function');
          assert.equal(typeof software.SoftwareKeyring, 'function');
          assert.equal(typeof library.utils.buildEthProof, 'function');
          assert.deepEqual(loads, []);
          await assert.rejects(library.utils.buildEthProof({}), /Proof dependency requested/);
          assert.deepEqual(loads, ['eth-proof']);
          console.log(JSON.stringify({ startupProofImports: 0, proofRequestImports: loads }));
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `,
    ],
    {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
      timeout: 15000,
    }
  );
  expect(JSON.parse(output)).toEqual({
    startupProofImports: 0,
    proofRequestImports: ['eth-proof'],
  });
});
