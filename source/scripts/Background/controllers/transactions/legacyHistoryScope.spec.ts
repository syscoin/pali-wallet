/** @jest-environment node */
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: {},
}));
jest.mock('../providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring/cjs/providers';

import MainController from '../MainController';
import { getEvmSettlementStatus } from 'utils/evmReplacement';

import { findUserTxsInProviderByBlocksRange } from './utils';

const HASH = `0x${'aa'.repeat(32)}`;
const BLOCK = `0x${'bb'.repeat(32)}`;
const FROM = `0x${'11'.repeat(20)}`;
const TO = `0x${'22'.repeat(20)}`;
let mockState: any;
function fixture(
  chainId: string | null | undefined,
  v: string,
  typeFour?: 'owner' | 'unrelated'
) {
  const methods: string[] = [];
  const raw: any = {
    hash: HASH,
    from: FROM,
    to: TO,
    nonce: '0x0',
    gas: '0x5208',
    gasPrice: '0x1',
    value: '0x1',
    input: '0x',
    blockNumber: '0x2a',
    blockHash: BLOCK,
    transactionIndex: '0x0',
    type: '0x0',
    v,
    r: `0x${'01'.padStart(64, '0')}`,
    s: `0x${'02'.padStart(64, '0')}`,
  };
  if (chainId !== undefined) raw.chainId = chainId;
  if (typeFour)
    Object.assign(raw, {
      type: '0x4',
      accessList: [],
      maxFeePerGas: '0x2',
      maxPriorityFeePerGas: '0x1',
      authorizationList: [
        {
          chainId: '0x1',
          address: TO,
          nonce: '0x0',
          yParity: '0x2',
          r: raw.r,
          s: raw.s,
        },
      ],
      ...(typeFour === 'unrelated' ? { from: '0x' + '44'.repeat(20) } : {}),
    });
  let remoteChain = '0x1';
  let receiptFields: Record<string, unknown> = {};
  const header = {
    number: '0x2a',
    hash: BLOCK,
    parentHash: `0x${'cc'.repeat(32)}`,
    timestamp: '0x65000000',
    nonce: '0x0000000000000000',
    difficulty: '0x0',
    gasLimit: '0x1c9c380',
    gasUsed: '0x5208',
    miner: FROM,
    extraData: '0x',
    baseFeePerGas: null,
  };
  const provider = new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://legacy.invalid',
    1,
    {
      fetch: async (_url, init) => {
        const payload = JSON.parse(String(init.body));
        const reply = (row: any) => {
          methods.push(row.method);
          let result: unknown;
          if (row.method === 'eth_chainId') result = remoteChain;
          else if (row.method === 'eth_blockNumber') result = '0x2a';
          else if (row.method === 'eth_getBlockByNumber')
            result = { ...header, transactions: row.params[1] ? [raw] : [] };
          else if (row.method === 'eth_getTransactionByHash') result = raw;
          else if (row.method === 'eth_getTransactionReceipt')
            result = {
              transactionHash: HASH,
              blockHash: BLOCK,
              blockNumber: '0x2a',
              transactionIndex: '0x0',
              from: FROM,
              to: TO,
              type: raw.type,
              status: '0x1',
              cumulativeGasUsed: '0x5208',
              gasUsed: '0x5208',
              effectiveGasPrice: '0x1',
              logs: [],
              logsBloom: `0x${'00'.repeat(256)}`,
              ...receiptFields,
            };
          else throw new Error(`Unexpected ${row.method}`);
          return { jsonrpc: '2.0', id: row.id, result };
        };
        return Response.json(
          Array.isArray(payload) ? payload.map(reply) : reply(payload)
        );
      },
    }
  );
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeNetwork: { chainId: 1, url: 'https://legacy.invalid' },
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: FROM } } },
    },
  };
  const wallet: any = Object.create(MainController.prototype);
  Object.defineProperty(wallet, 'ethereumTransaction', {
    value: { web3Provider: provider },
  });
  wallet.walletSessionGeneration = 1;
  wallet.walletStateGeneration = 1;
  return {
    provider,
    wallet,
    methods,
    setReceipt: (fields: Record<string, unknown>) => {
      receiptFields = fields;
    },
    setChain: (value: string) => {
      remoteChain = value;
    },
  };
}

test.each([
  [undefined, '0x1b'],
  [null, '0x1c'],
  ['0x0', '0x1b'],
  [undefined, '0x25'],
] as const)(
  'scopes canonical legacy history to observed chain for field %s and v %s',
  async (chainId, v) => {
    const f = fixture(chainId, v);
    try {
      const rows = await findUserTxsInProviderByBlocksRange(f.provider, 0);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ chainId: 1, nonce: 0, v });
      expect(
        f.methods.filter((method) => method === 'eth_chainId')
      ).toHaveLength(2);
      expect(f.methods).toHaveLength(5);
      expect(getEvmSettlementStatus(rows[0], 1)).toBe('confirmed');
      const details = await f.wallet.getEvmTransactionFromProvider(HASH);
      expect(details).toMatchObject({
        chainId: 1,
        status: 'success',
        blockNumber: 42,
      });
      expect(getEvmSettlementStatus(details, 1)).toBe('confirmed');
    } finally {
      f.provider.destroy();
    }
  }
);

test('RPC details retain historical placement and fee while tracking still requires a binary receipt status', async () => {
  const f = fixture(undefined, '0x1b');
  f.setReceipt({ status: undefined, root: `0x${'dd'.repeat(32)}` });
  try {
    const detail = await f.wallet.getEvmTransactionFromProvider(HASH, true);
    expect(detail).toMatchObject({
      blockNumber: 42,
      blockHash: BLOCK,
      transactionIndex: 0,
      status: 'unknown',
      success: null,
      txreceipt_status: null,
      isError: null,
      gasUsed: '21000',
      effectiveGasPrice: '1',
    });
    expect(await f.wallet.getEvmTransactionFromProvider(HASH)).toBeNull();
  } finally {
    f.provider.destroy();
  }
});

test('refuses a wrong endpoint before details disclose a hash and rejects protected signature mismatch', async () => {
  const wrong = fixture(undefined, '0x1b');
  wrong.setChain('0x2');
  try {
    expect(await wrong.wallet.getEvmTransactionFromProvider(HASH)).toBeNull();
    expect(wrong.methods).toEqual(['eth_chainId']);
  } finally {
    wrong.provider.destroy();
  }
  const protectedWrong = fixture(undefined, '0x27');
  try {
    await expect(
      findUserTxsInProviderByBlocksRange(protectedWrong.provider, 0)
    ).rejects.toThrow('History transaction network changed');
    expect(
      await protectedWrong.wallet.getEvmTransactionFromProvider(HASH)
    ).toBeNull();
  } finally {
    protectedWrong.provider.destroy();
  }
});

test.each(['owner', 'unrelated'] as const)(
  'canonical history isolates skipped authorization entries for %s transactions',
  async (mode) => {
    const f = fixture('0x1', '0x1', mode);
    try {
      await expect(f.provider.getTransaction(HASH)).rejects.toThrow(
        'value.authorizationList'
      );
      const rows = await findUserTxsInProviderByBlocksRange(f.provider, 0);
      expect(rows).toHaveLength(mode === 'owner' ? 1 : 0);
      if (mode === 'owner') {
        expect(rows[0]).toMatchObject({
          type: 4,
          hash: HASH,
          authorizationList: [{ yParity: '0x2' }],
        });
        await expect(
          f.wallet.getEvmTransactionFromProvider(HASH)
        ).resolves.toMatchObject({
          type: 4,
          status: 'success',
          blockNumber: 42,
        });
      }
    } finally {
      f.provider.destroy();
    }
  }
);
