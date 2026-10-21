const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { createServer } = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const pins = require('./pins.cjs');

const [backendRoot, paliRoot, ownerAddress] = process.argv.slice(2);
const requireBackend = createRequire(path.join(backendRoot, 'package.json'));
const {
  AbiCoder,
  ContractFactory,
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  hashMessage,
  keccak256,
  zeroPadValue,
} = requireBackend('ethers');
const request = requireBackend('supertest');
const { buildTestApp } = requireBackend('./tests/helpers/buildTestApp');
const { createRecoveryRpc } = requireBackend('./lib/recoveryRpc');
const { ZK_TANENBAUM } = requireBackend('./lib/recoveryRegistry');
const coder = AbiCoder.defaultAbiCoder();
let child;
let provider;
let fixture;
let account;
let call;

async function launch() {
  const text = readFileSync(
    path.join(paliRoot, 'source/utils/smartAccount/deployment.ts'),
    'utf8'
  );
  assert.equal(
    createHash('sha256').update(text).digest('hex'),
    pins.deploymentSourceSha256
  );
  const pick = (name) => {
    const match = text.match(new RegExp(`${name}:\\s*'(0x[0-9a-f]+)'`));
    assert.ok(match, `Missing bytecode: ${name}`);
    return match[1];
  };
  // Reuse the backend's pinned delegatecall proxy rather than synthesizing an
  // ERC1271 mock. No signature construction exists in this fixture.
  const original = readFileSync(
    path.join(backendRoot, 'tests/recovery-anvil.integration.mjs'),
    'utf8'
  );
  const proxyMatch = original.match(/const PROXY_CREATION = '(0x[0-9a-f]+)'/);
  assert.ok(proxyMatch, 'Pinned backend proxy fixture is missing');
  const proxy = proxyMatch[1];
  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  child = spawn(
    process.env.ANVIL_BIN || 'anvil',
    [
      '--silent',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--chain-id',
      '57057',
      '--hardfork',
      'cancun',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  let failed;
  child.once('error', (error) => {
    failed = error;
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 57057, {
    staticNetwork: true,
  });
  provider.pollingInterval = 25;
  let available = false;
  for (let i = 0; i < 80; i++) {
    if (failed) throw failed;
    assert.equal(child.exitCode, null, 'Owned Anvil process stopped');
    try {
      assert.equal(await provider.send('eth_chainId', []), '0xdee1');
      available = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.ok(available, 'Anvil did not start');
  const deployer = await provider.getSigner(0);
  const deploy = async (abi, bytecode, args = []) => {
    const contract = await new ContractFactory(abi, bytecode, deployer).deploy(
      ...args
    );
    await contract.waitForDeployment();
    return contract;
  };
  const validator = await deploy([], pick('ecdsaValidator'));
  const recovery = await deploy([], pick('guardianRecoveryModule'));
  const entryPoint = await deploy([], pick('entryPoint'));
  const accountBytecode = pick('accountImplementation');
  assert.equal(
    accountBytecode.slice(-64),
    zeroPadValue('0x433709009B8330FDa32311DF1C2AFA402eD8D009', 32)
      .slice(2)
      .toLowerCase()
  );
  const implementation = await deploy(
    [],
    accountBytecode.slice(0, -64) +
      coder.encode(['address'], [await entryPoint.getAddress()]).slice(2)
  );
  const validatorAddress = await validator.getAddress();
  const recoveryAddress = await recovery.getAddress();
  assert.equal(
    keccak256(await provider.getCode(recoveryAddress)),
    ZK_TANENBAUM.runtimeHash
  );
  const initData = coder.encode(
    [
      '(address module,bytes data)[]',
      '(address module,bytes data)[]',
      '(address module,bytes data)',
      '(address module,bytes data)[]',
    ],
    [
      [
        [
          validatorAddress,
          coder.encode(['address[]', 'uint64'], [[ownerAddress], 1]),
        ],
      ],
      [
        [
          recoveryAddress,
          coder.encode(
            ['uint32', 'uint32', 'address[]', 'uint64'],
            [600, 1200, [ownerAddress], 1]
          ),
        ],
      ],
      [ZeroAddress, '0x'],
      [],
    ]
  );
  const accountAbi = [
    'function initializeAccount(bytes)',
    'function isValidSignature(bytes32,bytes) view returns(bytes4)',
  ];
  const createAccount = async () =>
    deploy(['constructor(address implementation,bytes init)'], proxy, [
      await implementation.getAddress(),
      new Interface(accountAbi).encodeFunctionData('initializeAccount', [
        initData,
      ]),
    ]);
  const deployedAccount = await createAccount();
  const otherAccount = await createAccount();
  const accountAddress = await deployedAccount.getAddress();
  account = new Contract(accountAddress, accountAbi, provider);
  for (let n = 0; n < 3; n++) await provider.send('evm_mine', []);
  const config = { ...ZK_TANENBAUM, recoveryModule: recoveryAddress };
  const rpc = createRecoveryRpc(config, {
    request: (method, params) => provider.send(method, params),
  });
  fixture = buildTestApp({ recoveryChains: [{ ...config, rpc }] });
  const user = fixture.users.create({
    email: 'component-integration@example.test',
    authHash: 'a'.repeat(64),
  });
  fixture.users.markEmailVerified(user.id);
  const token = fixture.sessions.issue(user.id).token;
  call = (method, url) =>
    request(fixture.app)
      [method](url)
      .set('Cookie', `sid=${token}; csrf=component-csrf`)
      .set('X-CSRF-Token', 'component-csrf');
  return {
    accountAddress,
    otherAccountAddress: await otherAccount.getAddress(),
    validatorAddress,
    recoveryAddress,
    chainId: 57057,
    rpcUrl: `http://127.0.0.1:${port}`,
    runtimeHash: ZK_TANENBAUM.runtimeHash,
    sourceHash: createHash('sha256').update(text).digest('hex'),
  };
}

async function cleanup() {
  if (fixture) {
    fixture.recoveryMonitor.stop();
    fixture.db.close();
  }
  provider?.destroy();
  child?.kill('SIGTERM');
  if (child && child.exitCode === null)
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
}

process.on('message', async ({ id, command, params }) => {
  try {
    let result;
    if (command === 'start') result = await launch();
    else if (command === 'challenge') {
      const response = await call('post', '/recovery/challenges').send({
        chainId: 57057,
        account: await account.getAddress(),
      });
      result = { status: response.status, body: response.body };
    } else if (command === 'enroll') {
      const response = await call('post', '/recovery/subscriptions').send(
        params
      );
      result = { status: response.status, body: response.body };
    } else if (command === 'verify') {
      result = await account.isValidSignature(
        hashMessage(params.message),
        params.signature
      );
    } else if (command === 'status') {
      const response = await call('get', '/recovery/subscriptions');
      result = {
        status: response.status,
        body: response.body,
        mailCount: fixture.mailer.outbox.length,
      };
    } else if (command === 'stop') {
      await cleanup();
      process.send({ id, result: true }, () => process.exit(0));
      return;
    } else throw new Error(`Unknown command: ${command}`);
    process.send({ id, result });
  } catch (error) {
    process.send({ id, error: error.stack || String(error) });
  }
});
process.once('disconnect', () => cleanup().finally(() => process.exit(0)));
