import { webcrypto } from 'crypto';
import fs from 'fs';
import NodePolyfillPlugin from 'node-polyfill-webpack-plugin';
import os from 'os';
import path from 'path';
import vm from 'vm';
import webpack from 'webpack';

import aliases from '../../source/config/ethersPublicAliases';
import common from '../../source/config/webpack.common';

const ethersRoot = path.dirname(path.dirname(require.resolve('ethers')));
const ethersPackage = JSON.parse(
  fs.readFileSync(path.join(ethersRoot, 'package.json'), 'utf8')
);
const requests = Object.keys(ethersPackage.exports).map((request) =>
  request === '.' ? 'ethers' : `ethers${request.slice(1)}`
);

// This fixture uses both syntaxes plus the installed SDK's real CommonJS
// provider/compatibility modules. Its only network responses are synthetic.
const entry = `
${requests
  .map(
    (request, index) =>
      `import * as esm${index} from ${JSON.stringify(request)};
       const cjs${index} = require(${JSON.stringify(request)});`
  )
  .join('\n')}
import * as api from 'ethers';
const sdk = require('@sidhujag/sysweb3-keyring/cjs/ethers-v6');
const { CustomJsonRpcProvider } = require('@sidhujag/sysweb3-keyring/cjs/providers');
export const identity = [${requests
  .map(
    (_, index) =>
      `Object.keys(esm${index}).every(key => esm${index}[key] === cjs${index}[key])`
  )
  .join(',')}];
export const sdkIdentity = [
  sdk.Contract === api.Contract,
  sdk.JsonRpcProvider === api.JsonRpcProvider,
  sdk.getAddress === api.getAddress,
  sdk.keccak256 === api.keccak256,
  CustomJsonRpcProvider.prototype instanceof api.JsonRpcProvider
];
export const shape = [typeof cjs0.default, typeof sdk.Contract, typeof sdk.BigNumber.from];
export const cryptoApi = { randomBytes: api.randomBytes, keccak256: api.keccak256, sha256: api.sha256, lock: api.lock };
export const english = [Object.keys(api.wordlists), api.wordlists.en.getWord(0), api.wordlists.en.getWord(2047)];
export const normalizeEns = api.ensNormalize;
export function signSynthetic() {
  const wallet = new api.Wallet('0x' + '11'.repeat(32));
  const tx = { type: 2, chainId: 1, nonce: 7, to: '0x' + '22'.repeat(20), value: 123n,
    gasLimit: 21000, maxFeePerGas: 100, maxPriorityFeePerGas: 2 };
  const unsigned = sdk.serializeTransaction(tx);
  const nativeUnsigned = api.Transaction.from(tx).unsignedSerialized;
  const signed = sdk.serializeTransaction(tx, wallet.signingKey.sign(api.Transaction.from(unsigned).unsignedHash));
  const parsed = api.Transaction.from(signed);
  return { unsignedMatches: unsigned === nativeUnsigned, recovered: parsed.from,
    expected: wallet.address, chainId: String(parsed.chainId), nonce: parsed.nonce,
    value: String(parsed.value), fee: String(parsed.maxFeePerGas) };
}
export async function browserFetch() {
  const response = await new api.FetchRequest('https://fetch.invalid/synthetic').send();
  return response.bodyText;
}
export async function browserWebSocket() {
  const provider = new api.WebSocketProvider('wss://socket.invalid', 1, { staticNetwork: true });
  const socket = provider.websocket;
  await provider.destroy();
  return socket.url;
}
export async function sdkRead() {
  const controller = new AbortController();
  const provider = new CustomJsonRpcProvider(controller.signal, 'https://rpc.invalid', 1);
  try { return await provider.sendBatch('eth_getBalance', [['0x' + '22'.repeat(20), 'latest']]); }
  finally { provider.destroy(); }
}
export async function resolveSyntheticEns(extended) {
  const name = extended ? 'child.wildcard.eth' : 'direct.eth';
  const destination = '0x' + '22'.repeat(20);
  const resolver = '0x' + '44'.repeat(20);
  const controller = new AbortController();
  const provider = new CustomJsonRpcProvider(controller.signal, 'https://ens.invalid', 1);
  const network = await provider.getNetwork();
  const universal = network.getPlugin('org.ethers.plugins.network.Ens').universalResolver;
  const universalAbi = new api.Interface(['function requireResolver(bytes) view returns ((bytes name, uint256 offset, bytes32 node, address resolver, bool extended))']);
  const resolverAbi = new api.Interface(['function addr(bytes32) view returns (address)', 'function resolve(bytes, bytes) view returns (bytes)']);
  const reads = [];
  provider.call = async transaction => {
    const to = String(transaction.to).toLowerCase();
    if (to === universal.toLowerCase()) {
      const parsed = universalAbi.parseTransaction(transaction);
      if (parsed.name !== 'requireResolver' || parsed.args[0] !== api.dnsEncode(name)) throw new Error('Unexpected ENS lookup');
      reads.push(parsed.name);
      return universalAbi.encodeFunctionResult('requireResolver', [[api.dnsEncode(name), 0, api.namehash(name), resolver, extended]]);
    }
    if (to !== resolver.toLowerCase()) throw new Error('Unexpected ENS resolver');
    const parsed = resolverAbi.parseTransaction(transaction);
    const inner = extended ? resolverAbi.parseTransaction({ data: parsed.args[1] }) : parsed;
    if (inner.name !== 'addr' || inner.args[0] !== api.namehash(name) || (parsed.name === 'resolve') !== extended) throw new Error('Unexpected ENS record');
    reads.push(parsed.name);
    const result = resolverAbi.encodeFunctionResult('addr', [destination]);
    return extended ? resolverAbi.encodeFunctionResult('resolve', [result]) : result;
  };
  try { return { address: await provider.resolveName(name), destination, reads }; }
  finally { provider.destroy(); }
}
`;

describe('ethers public browser bundle resolution', () => {
  let directory: string;
  let bundle: string;
  let resources: string[];

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-ethers-bundle-'));
    const input = path.join(directory, 'entry.js');
    fs.writeFileSync(input, entry);
    const compiler = webpack({
      mode: 'production',
      target: ['web', 'es2020'],
      entry: input,
      devtool: false,
      output: {
        path: path.join(directory, 'output'),
        filename: 'fixture.js',
        library: { type: 'commonjs2' },
      },
      resolve: {
        ...(common.resolve as webpack.Configuration['resolve']),
        modules: [
          path.resolve(__dirname, '../../node_modules'),
          'node_modules',
        ],
      },
      optimization: { minimize: false, concatenateModules: false },
      plugins: [new NodePolyfillPlugin({ excludeAliases: ['console'] })],
    });
    const stats = await new Promise<webpack.Stats>((resolve, reject) => {
      compiler.run((error, result) => {
        compiler.close((closeError) => {
          if (error || closeError) reject(error || closeError);
          else if (!result || result.hasErrors())
            reject(new Error(result?.toString({ all: false, errors: true })));
          else resolve(result);
        });
      });
    });
    resources = Array.from(stats.compilation.modules)
      .map((module: any) => module.resource)
      .filter(Boolean);
    bundle = fs.readFileSync(path.join(directory, 'output/fixture.js'), 'utf8');
  });

  afterAll(() => {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  const runtime = (hasCrypto = true) => {
    const getRandomValues = jest.fn((value) =>
      webcrypto.getRandomValues(value)
    );
    const fetch = jest.fn<Promise<Response>, [string, any?]>(async () => {
      throw new Error('Unexpected network request in ethers bundle fixture');
    });
    const socket = { url: '', close: jest.fn(), send: jest.fn() };
    class WebSocket {
      constructor(url: string) {
        socket.url = url;
        return socket;
      }
    }
    const sandbox: any = {
      module: { exports: {} },
      crypto: hasCrypto ? { getRandomValues } : undefined,
      fetch,
      WebSocket,
      AbortController,
      Headers,
      URL,
      TextEncoder,
      TextDecoder,
      atob,
      btoa,
      Buffer,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    };
    sandbox.self = sandbox;
    new vm.Script(bundle).runInContext(vm.createContext(sandbox));
    return { api: sandbox.module.exports, fetch, getRandomValues, socket };
  };

  it('aliases only exact declared ethers requests to this package ESM exports', () => {
    expect(Object.keys(aliases)).toEqual(
      requests.map((request) => request + '$')
    );
    for (const [request, exportTarget] of Object.entries<any>(
      ethersPackage.exports
    )) {
      const key = `${
        request === '.' ? 'ethers' : `ethers${request.slice(1)}`
      }$`;
      expect(aliases[key]).toBe(path.resolve(ethersRoot, exportTarget.import));
      expect(common.resolve.alias[key]).toBe(aliases[key]);
    }
    expect(common.resolve.alias['ethers']).toBeUndefined();
    expect(
      Object.keys(aliases).some((name) => name.includes('@ethersproject'))
    ).toBe(false);
  });

  it('bundles one ESM implementation for imports and installed SDK CommonJS callers', () => {
    const { api, fetch } = runtime();
    expect(api.identity).toEqual(requests.map(() => true));
    expect(api.sdkIdentity).toEqual([true, true, true, true, true]);
    expect(api.shape).toEqual(['undefined', 'function', 'function']);
    expect(
      resources.some((file) => file.includes('/ethers/lib.commonjs/'))
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains every package browser mapping and its English-only wordlists', () => {
    for (const [original, replacement] of Object.entries<string>(
      ethersPackage.browser
    )) {
      expect(resources).toContain(path.resolve(ethersRoot, replacement));
      expect(resources).not.toContain(path.resolve(ethersRoot, original));
    }
    const { api } = runtime();
    expect(api.english).toEqual([['en'], 'abandon', 'zoo']);
  });

  it('uses native browser randomness and retains primitive locking and known hashes', () => {
    const { api, getRandomValues } = runtime();
    expect(api.cryptoApi.keccak256('0x')).toBe(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
    );
    expect(api.cryptoApi.sha256('0x')).toBe(
      '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(api.cryptoApi.randomBytes(16)).toHaveLength(16);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    api.cryptoApi.lock();
    expect(() =>
      api.cryptoApi.randomBytes.register(() => new Uint8Array(16))
    ).toThrow('locked');
    expect(() =>
      api.cryptoApi.keccak256.register(() => new Uint8Array(32))
    ).toThrow('locked');
  });

  it('refuses randomness when secure browser crypto is absent', () => {
    const { api } = runtime(false);
    expect(() => api.cryptoApi.randomBytes(16)).toThrow('secure random');
  });

  it('keeps the SDK serializer compatible with native synthetic transaction signing', () => {
    const { api, fetch } = runtime();
    const signed = api.signSynthetic();
    expect(signed).toEqual({
      unsignedMatches: true,
      recovered: signed.expected,
      expected: signed.expected,
      chainId: '1',
      nonce: 7,
      value: '123',
      fee: '100',
    });
    expect(signed.expected).toBe('0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('routes fetch and WebSocket through the browser implementations', async () => {
    const { api, fetch, socket } = runtime();
    fetch.mockResolvedValueOnce(
      new Response('synthetic response', { status: 200 })
    );
    await expect(api.browserFetch()).resolves.toBe('synthetic response');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://fetch.invalid/synthetic');
    await expect(api.browserWebSocket()).resolves.toBe('wss://socket.invalid');
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('keeps SDK RPC response correlation fail-closed after its bounded read retry', async () => {
    const { api, fetch } = runtime();
    fetch.mockImplementation(async (_url, options) => {
      const rpcRequests = JSON.parse(options.body);
      return new Response(
        JSON.stringify(
          rpcRequests.map((request) => ({
            jsonrpc: '2.0',
            id: request.id + 1000,
            result: '0x1',
          }))
        ),
        { status: 200 }
      );
    });
    await expect(api.sdkRead()).rejects.toThrow('SYSWEB3_RPC_RESPONSE_INVALID');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'keeps native ENS resolution and validation (wildcard=%s)',
    async (extended) => {
      const { api, fetch } = runtime();
      expect(api.normalizeEns('ExAmPle.eth')).toBe('example.eth');
      expect(() => api.normalizeEns('invalid..eth')).toThrow();
      await expect(api.resolveSyntheticEns(extended)).resolves.toEqual({
        address: '0x' + '22'.repeat(20),
        destination: '0x' + '22'.repeat(20),
        reads: ['requireResolver', extended ? 'resolve' : 'addr'],
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  );
});
