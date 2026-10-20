import {
  AbiCoder,
  HDNodeWallet,
  Interface,
  concat,
  getCreate2Address,
  keccak256,
} from 'ethers';

import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountFactoryInterface,
} from '../../source/utils/smartAccount/contracts';
import {
  getPaliInfrastructureContracts,
  PALI_CREATE2_DEPLOYER_ADDRESS,
  PALI_MULTICALL3_CANONICAL_ADDRESS,
} from '../../source/utils/smartAccount/deployment';

import type { BrowserContext } from '@playwright/test';

// The existing goldens intentionally retain this public QA identity. All chain
// and market observations below are synthetic: this fixture never contacts or
// funds that address on a public network.
export const VISUAL_FIXTURE_SEED =
  'abuse expect crisp unaware skirt adjust height coin seven attitude usual kick';
export const VISUAL_FIXTURE_ADDRESS =
  '0xfFC854565ff83a49d3302821c0AD23822ca1A50C';
export const VISUAL_FIXTURE_CHAIN_ID = 57057;
export const VISUAL_FIXTURE_RPC = 'https://rpc-zk.tanenbaum.io';
export const VISUAL_FIXTURE_EXPLORER = 'https://explorer-zk.tanenbaum.io';

const abi = AbiCoder.defaultAbiCoder();
const initialization = new Interface([
  'function initializeAccount(bytes initCode)',
]);
const moduleArray = 'tuple(address module,bytes data)[]';
const emptyModule = ['0x0000000000000000000000000000000000000000', '0x'];
const transactionHash = `0x${'71'.repeat(32)}`;
const blockHash = `0x${'72'.repeat(32)}`;
const parentHash = `0x${'73'.repeat(32)}`;
const headHash = `0x${'74'.repeat(32)}`;
const peer = '0x1111111111111111111111111111111111111111';
const isAddress = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
const lower = (value: string) => value.toLowerCase();
const encodeInitData = (validator: string, data: string) =>
  abi.encode(
    [moduleArray, moduleArray, 'tuple(address module,bytes data)', moduleArray],
    [[[validator, data]], [], emptyModule, []]
  );
const proxyDeployment = (
  proxy: string,
  implementation: string,
  initCode: string
) =>
  concat([
    proxy,
    abi.encode(
      ['address', 'bytes'],
      [
        implementation,
        initialization.encodeFunctionData('initializeAccount', [initCode]),
      ]
    ),
  ]);

export function createVisualFixture() {
  if (
    HDNodeWallet.fromPhrase(VISUAL_FIXTURE_SEED).address !==
    VISUAL_FIXTURE_ADDRESS
  )
    throw new Error('Visual QA identity derivation changed');
  const infrastructure = getPaliInfrastructureContracts(
    VISUAL_FIXTURE_CHAIN_ID
  );
  const factory = infrastructure.find((contract) => contract.id === 'factory');
  const implementation = infrastructure.find(
    (contract) => contract.id === 'accountImplementation'
  );
  const validator = infrastructure.find(
    (contract) => contract.id === 'ecdsaValidator'
  );
  if (!factory?.deployCalldata || !implementation || !validator)
    throw new Error('Visual fixture requires canonical factory deployment');

  // Use the exact ERC1967Proxy creation code embedded by the checked factory,
  // rather than inventing a predicted address or duplicating its bytecode.
  // The prefix includes the compiled creation-code size (0x026c).
  const proxyPrefix = '608060405261026c803803806100148161016e565b';
  const deployment = lower(factory.deployCalldata);
  const start = deployment.indexOf(proxyPrefix);
  const proxyCreationCode = `0x${deployment.slice(start, start + 0x26c * 2)}`;
  if (
    start < 0 ||
    deployment.indexOf(proxyPrefix, start + 1) !== -1 ||
    proxyCreationCode.length !== 2 + 0x26c * 2 ||
    !proxyCreationCode.endsWith('3d5ffd')
  )
    throw new Error('Canonical factory proxy creation code changed');

  const authenticatorData = abi.encode(
    ['address[]', 'uint64'],
    [[VISUAL_FIXTURE_ADDRESS], 1]
  );
  const initCode = encodeInitData(validator.address, authenticatorData);
  const anchor = `pali:eip155:${VISUAL_FIXTURE_CHAIN_ID}:${lower(
    VISUAL_FIXTURE_ADDRESS
  )}:smart-account-v1`;
  const deploymentSalt = keccak256(
    abi.encode(
      ['string', 'uint256', 'address', 'bytes32', 'uint256'],
      [
        'PaliSmartAccount.ERC7579.anchor-salt.v1',
        VISUAL_FIXTURE_CHAIN_ID,
        factory.address,
        keccak256(abi.encode(['string'], [anchor])),
        0,
      ]
    )
  );
  const smartAccountAddress = getCreate2Address(
    factory.address,
    deploymentSalt,
    keccak256(
      proxyDeployment(proxyCreationCode, implementation.address, initCode)
    )
  );

  const transaction = {
    hash: transactionHash,
    from: peer,
    to: VISUAL_FIXTURE_ADDRESS,
    value: '1000000000000000000',
    input: '0x',
    nonce: '1',
    blockNumber: '42',
    blockHash,
    transactionIndex: '0',
    timeStamp: '1700000000',
    gas: '21000',
    gasUsed: '21000',
    gasPrice: '1000000000',
    confirmations: '2',
    chainId: VISUAL_FIXTURE_CHAIN_ID,
    isError: '0',
    // Explorer wire spelling.
    // eslint-disable-next-line camelcase
    txreceipt_status: '1',
  };
  return {
    address: VISUAL_FIXTURE_ADDRESS,
    balanceWei: '248880000000000000000',
    factory,
    authenticatorData,
    deploymentSalt,
    initCode,
    implementation,
    infrastructure,
    proxyCreationCode,
    smartAccountAddress,
    transaction,
    transactions: Array.from({ length: 15 }, (_, index) => ({
      ...transaction,
      hash:
        index === 0
          ? transactionHash
          : `0x${(113 + index).toString(16).padStart(2, '0').repeat(32)}`,
      nonce: String(1 + index),
      transactionIndex: String(index),
    })),
    validator,
  };
}

export type VisualFixture = ReturnType<typeof createVisualFixture>;

function factoryRead(fixture: VisualFixture, data: string): string | undefined {
  let parsed;
  try {
    parsed = paliSmartAccountFactoryInterface.parseTransaction({ data });
  } catch {
    return undefined;
  }
  if (!parsed) return undefined;
  if (parsed.signature === 'getInitData(address,bytes)') {
    if (
      lower(parsed.args[0]) !== lower(fixture.validator.address) ||
      lower(parsed.args[1]) !== lower(fixture.authenticatorData)
    )
      return undefined;
    const initCode = encodeInitData(parsed.args[0], parsed.args[1]);
    return paliSmartAccountFactoryInterface.encodeFunctionResult(
      parsed.fragment,
      [initCode]
    );
  }
  if (parsed.signature === 'getAddress(bytes32,bytes)') {
    if (
      lower(parsed.args[0]) !== lower(fixture.deploymentSalt) ||
      lower(parsed.args[1]) !== lower(fixture.initCode)
    )
      return undefined;
    const creation = proxyDeployment(
      fixture.proxyCreationCode,
      fixture.implementation.address,
      parsed.args[1]
    );
    return paliSmartAccountFactoryInterface.encodeFunctionResult(
      parsed.fragment,
      [
        getCreate2Address(
          fixture.factory.address,
          parsed.args[0],
          keccak256(creation)
        ),
      ]
    );
  }
  if (parsed.signature === 'implementation()')
    return paliSmartAccountFactoryInterface.encodeFunctionResult(
      parsed.fragment,
      [fixture.implementation.address]
    );
  return undefined;
}

function rpcRead(fixture: VisualFixture, method: string, params: unknown[]) {
  const knownAccount = (value: unknown): value is string =>
    isAddress(value) &&
    [fixture.address, fixture.smartAccountAddress, peer].some(
      (address) => lower(address) === lower(value)
    );
  const knownCodeTarget = (value: unknown): value is string =>
    isAddress(value) &&
    (knownAccount(value) ||
      lower(value) === lower(PALI_CREATE2_DEPLOYER_ADDRESS) ||
      lower(value) === lower(PALI_MULTICALL3_CANONICAL_ADDRESS) ||
      fixture.infrastructure.some(
        (contract) => lower(contract.address) === lower(value)
      ));
  const transaction = fixture.transactions.find(
    (row) => row.hash === params[0]
  );
  const rpcTransaction = (row: VisualFixture['transaction']) => ({
    ...row,
    value: `0x${BigInt(row.value).toString(16)}`,
    gas: '0x5208',
    gasPrice: '0x3b9aca00',
    nonce: `0x${BigInt(row.nonce).toString(16)}`,
    blockNumber: '0x2a',
    transactionIndex: `0x${BigInt(row.transactionIndex).toString(16)}`,
    chainId: '0xdee1',
    type: '0x0',
    r: `0x${'01'.repeat(32)}`,
    s: `0x${'02'.repeat(32)}`,
    v: '0x1b',
  });
  switch (method) {
    case 'eth_chainId':
      return '0xdee1';
    case 'net_version':
      return String(VISUAL_FIXTURE_CHAIN_ID);
    case 'eth_blockNumber':
      return '0x2b';
    case 'eth_getBalance':
      if (!knownAccount(params[0])) return undefined;
      return lower(params[0]) === lower(fixture.address)
        ? `0x${BigInt(fixture.balanceWei).toString(16)}`
        : '0x0';
    case 'eth_getTransactionCount':
      if (!knownAccount(params[0])) return undefined;
      return lower(params[0]) === lower(fixture.address) ? '0x1' : '0x0';
    case 'eth_gasPrice':
    case 'eth_maxPriorityFeePerGas':
      return '0x3b9aca00';
    case 'eth_estimateGas':
      if (!params[0] || typeof params[0] !== 'object') return undefined;
      if (!knownAccount((params[0] as { to?: unknown }).to)) return undefined;
      return '0x5208';
    case 'eth_feeHistory':
      return {
        oldestBlock: '0x2a',
        baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
        gasUsedRatio: [0.5],
        reward: [
          Array.from(
            { length: Array.isArray(params[2]) ? params[2].length : 1 },
            () => '0x3b9aca00'
          ),
        ],
      };
    case 'eth_getCode': {
      if (!knownCodeTarget(params[0])) return undefined;
      const target = lower(params[0]);
      return target === lower(PALI_CREATE2_DEPLOYER_ADDRESS) ||
        fixture.infrastructure.some(
          (contract) => !contract.optional && lower(contract.address) === target
        )
        ? '0x60006000f3'
        : '0x';
    }
    case 'eth_call': {
      const call = params[0] as { data?: unknown; to?: unknown } | undefined;
      if (!knownCodeTarget(call?.to) || typeof call?.data !== 'string')
        return undefined;
      if (lower(call.to) === lower(fixture.factory.address))
        return factoryRead(fixture, call.data);
      // Unregistered accounts and absent optional Multicall3 have no runtime.
      if (
        !fixture.infrastructure.some(
          (contract) =>
            !contract.optional &&
            lower(contract.address) === lower(call.to as string)
        )
      )
        return '0x';
      return undefined;
    }
    case 'eth_getLogs': {
      const filter = params[0] as Record<string, unknown> | undefined;
      const block = (value: unknown): number | undefined => {
        if (typeof value === 'number' && Number.isSafeInteger(value))
          return value;
        if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)) {
          const parsed = Number(BigInt(value));
          if (Number.isSafeInteger(parsed)) return parsed;
        }
        return undefined;
      };
      if (
        params.length !== 1 ||
        !filter ||
        Array.isArray(filter) ||
        Object.keys(filter).some(
          (key) => !['address', 'fromBlock', 'toBlock', 'topics'].includes(key)
        ) ||
        !isAddress(filter.address) ||
        lower(filter.address) !==
          lower(getPaliEntryPointAddress(VISUAL_FIXTURE_CHAIN_ID))
      )
        return undefined;
      const from = block(filter.fromBlock);
      const to = block(filter.toBlock);
      const topics = filter.topics;
      if (
        from === undefined ||
        to === undefined ||
        from < 0 ||
        from > to ||
        to > 43 ||
        !Array.isArray(topics) ||
        topics.length !== 3 ||
        topics[0] !==
          paliEntryPointInterface.getEvent('UserOperationEvent')!.topicHash ||
        topics[1] !== null ||
        typeof topics[2] !== 'string' ||
        lower(topics[2]) !==
          `0x${lower(fixture.smartAccountAddress).slice(2).padStart(64, '0')}`
      )
        return undefined;
      return [];
    }
    case 'eth_getTransactionByHash':
      return transaction ? rpcTransaction(transaction) : null;
    case 'eth_getTransactionReceipt':
      return transaction
        ? {
            transactionHash: transaction.hash,
            transactionIndex: `0x${BigInt(
              transaction.transactionIndex
            ).toString(16)}`,
            blockHash,
            blockNumber: '0x2a',
            from: peer,
            to: fixture.address,
            cumulativeGasUsed: `0x${(
              (BigInt(transaction.transactionIndex) + BigInt(1)) *
              BigInt(21000)
            ).toString(16)}`,
            gasUsed: '0x5208',
            effectiveGasPrice: '0x3b9aca00',
            logs: [],
            logsBloom: `0x${'00'.repeat(256)}`,
            status: '0x1',
            type: '0x0',
            contractAddress: null,
          }
        : null;
    case 'eth_getBlockByNumber':
    case 'eth_getBlockByHash': {
      const historical =
        params[0] === (method === 'eth_getBlockByHash' ? blockHash : '0x2a');
      const head =
        method === 'eth_getBlockByHash'
          ? params[0] === headHash
          : ['latest', 'pending', '0x2b'].includes(params[0] as string);
      if (!historical && !head) return null;
      return {
        number: historical ? '0x2a' : '0x2b',
        hash: historical ? blockHash : headHash,
        parentHash: historical ? parentHash : blockHash,
        nonce: '0x0000000000000000',
        timestamp: historical ? '0x6553f100' : '0x6553f10c',
        difficulty: '0x0',
        gasLimit: '0x1c9c380',
        gasUsed: historical ? '0x4ce78' : '0x0',
        miner: '0x0000000000000000000000000000000000000000',
        extraData: '0x',
        transactions: historical
          ? fixture.transactions.map((row) =>
              params[1] ? rpcTransaction(row) : row.hash
            )
          : [],
        baseFeePerGas: '0x3b9aca00',
      };
    }
    default:
      return undefined;
  }
}

export type VisualRead = {
  body: unknown;
  reads: string[];
  unsupported?: string[];
};

// Pure wire boundary used by the browser interceptor and unit tests. Unknown
// requests are never forwarded, and unsupported RPCs fail rather than receiving
// a successful empty result that could conceal a missing fixture prerequisite.
export function visualFixtureRead(
  fixture: VisualFixture,
  requestUrl: string,
  method: string,
  payload?: unknown
): VisualRead | undefined {
  const url = new URL(requestUrl);
  if (url.username || url.password || url.hash) return undefined;
  if (
    url.origin === VISUAL_FIXTURE_RPC &&
    url.pathname === '/' &&
    !url.search &&
    method === 'POST'
  ) {
    const calls = Array.isArray(payload) ? payload : [payload];
    if (!calls.length)
      return {
        body: {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Empty fixture batch' },
        },
        reads: [],
        unsupported: ['empty-rpc-batch'],
      };
    const unsupported: string[] = [];
    const reads: string[] = [];
    const replies = calls.map((call) => {
      const row = call as
        | {
            id?: unknown;
            jsonrpc?: string;
            method?: string;
            params?: unknown[];
          }
        | undefined;
      if (
        !row ||
        row.jsonrpc !== '2.0' ||
        typeof row.method !== 'string' ||
        !Array.isArray(row.params)
      ) {
        unsupported.push('malformed-rpc');
        return {
          jsonrpc: '2.0',
          id: row?.id ?? null,
          error: { code: -32600, message: 'Invalid fixture request' },
        };
      }
      const write =
        /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
          row.method
        );
      const result = write
        ? undefined
        : rpcRead(fixture, row.method, row.params);
      if (result === undefined) {
        unsupported.push(row.method);
        return {
          jsonrpc: '2.0',
          id: row.id,
          error: { code: -32601, message: 'Unsupported visual fixture read' },
        };
      }
      reads.push(`rpc:${row.method}`);
      return { jsonrpc: '2.0', id: row.id, result };
    });
    return {
      body: Array.isArray(payload) ? replies : replies[0],
      reads,
      unsupported,
    };
  }
  if (
    method === 'GET' &&
    url.origin === VISUAL_FIXTURE_EXPLORER &&
    url.pathname === '/api'
  ) {
    const action = url.searchParams.get('action');
    const address = url.searchParams.get('address');
    let result: unknown;
    if (
      ['txlist', 'pendingtxlist', 'tokentx', 'tokenlist'].includes(
        action || ''
      ) &&
      isAddress(address) &&
      [fixture.address, fixture.smartAccountAddress].some(
        (known) => lower(known) === lower(address)
      )
    ) {
      result =
        action === 'txlist' &&
        lower(address) === lower(fixture.address) &&
        Number(url.searchParams.get('page') || 1) === 1
          ? fixture.transactions
          : [];
    } else if (
      action === 'gettxinfo' &&
      fixture.transactions.some(
        (row) => row.hash === url.searchParams.get('txhash')
      )
    ) {
      result = fixture.transactions.find(
        (row) => row.hash === url.searchParams.get('txhash')
      );
    } else if (action === 'eth_block_number') {
      result = '0x2b';
    } else return undefined;
    return {
      body: {
        status:
          action !== 'tokenlist' && Array.isArray(result) && !result.length
            ? '0'
            : '1',
        message:
          action !== 'tokenlist' && Array.isArray(result) && !result.length
            ? 'No transactions found'
            : 'OK',
        result,
      },
      reads: [`explorer:${action}`],
    };
  }
  if (
    method === 'GET' &&
    url.origin === 'https://api.coingecko.com' &&
    url.pathname === '/api/v3/simple/price' &&
    url.searchParams.get('ids') === 'syscoin'
  ) {
    return {
      body: {
        syscoin: {
          usd: 0.04,
          // eslint-disable-next-line camelcase -- CoinGecko wire field.
          usd_24h_change: 0,
          // eslint-disable-next-line camelcase -- CoinGecko wire field.
          usd_24h_vol: 100000,
          // eslint-disable-next-line camelcase -- CoinGecko wire field.
          usd_market_cap: 32000000,
        },
      },
      reads: ['market:syscoin'],
    };
  }
  return undefined;
}

export async function installVisualFixtureRoutes(
  context: BrowserContext,
  fixture: VisualFixture,
  localOrigin: string
) {
  const reads: string[] = [],
    deniedWrites: string[] = [],
    deniedUnknown: string[] = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (
      url.origin === localOrigin &&
      url.pathname === '/' &&
      request.method() === 'GET'
    )
      return route.continue();
    let payload: unknown;
    try {
      payload = request.postDataJSON();
    } catch {
      /* Ordinary GET. */
    }
    const calls = Array.isArray(payload) ? payload : [payload];
    const writes = calls.filter((call) =>
      /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
        (call as { method?: string })?.method || ''
      )
    );
    if (writes.length || /\/sendtx(?:\/|$)/i.test(url.pathname)) {
      deniedWrites.push(
        ...(writes.length
          ? writes.map((call) => (call as { method: string }).method)
          : [url.pathname])
      );
      return route.abort('blockedbyclient');
    }
    const result = visualFixtureRead(
      fixture,
      request.url(),
      request.method(),
      payload
    );
    if (!result) {
      deniedUnknown.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    reads.push(...result.reads);
    deniedUnknown.push(
      ...(result.unsupported || []).map((name) => `rpc:${name}`)
    );
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(result.body),
    });
  });
  return { reads, deniedWrites, deniedUnknown };
}
