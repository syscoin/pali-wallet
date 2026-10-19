import { expect, test, type BrowserContext } from '@playwright/test';
import {
  AbiCoder,
  HDNodeWallet,
  Interface,
  concat,
  getCreate2Address,
  keccak256,
} from 'ethers';

import {
  encodeEcdsaValidatorInitData,
  getPaliSmartAccountDeploymentSalt,
} from '../../source/utils/smartAccount/account';
import { paliSmartAccountFactoryInterface } from '../../source/utils/smartAccount/contracts';
import { PALI_CREATE2_DEPLOYER_ADDRESS } from '../../source/utils/smartAccount/deployment';
import {
  createVisualFixture,
  installVisualFixtureRoutes,
  visualFixtureRead,
  VISUAL_FIXTURE_ADDRESS,
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_EXPLORER,
  VISUAL_FIXTURE_RPC,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

const abi = AbiCoder.defaultAbiCoder();
const rpcUrl = `${VISUAL_FIXTURE_RPC}/`;
const foreignAddress = '0x2222222222222222222222222222222222222222';
const rpc = (method: string, params: unknown[] = [], id = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
});

test.describe('visual network fixture boundaries', () => {
  const fixture = () => createVisualFixture();
  const result = (
    value: ReturnType<typeof createVisualFixture>,
    method: string,
    params: unknown[] = []
  ) => {
    const response = visualFixtureRead(
      value,
      rpcUrl,
      'POST',
      rpc(method, params)
    );
    expect(response?.unsupported).toEqual([]);
    expect(response?.body).toMatchObject({ jsonrpc: '2.0', id: 1 });
    return (response!.body as { result: unknown }).result;
  };
  const explorer = (action: string, fields: Record<string, string>) => {
    const url = new URL('/api', VISUAL_FIXTURE_EXPLORER);
    url.searchParams.set(
      'module',
      action === 'gettxinfo' ? 'transaction' : 'account'
    );
    url.searchParams.set('action', action);
    Object.entries(fields).forEach(([key, value]) =>
      url.searchParams.set(key, value)
    );
    return url.toString();
  };

  test('retains the golden identity, funded balance and coherent fee reads', () => {
    const value = fixture();
    expect(HDNodeWallet.fromPhrase(VISUAL_FIXTURE_SEED).address).toBe(
      VISUAL_FIXTURE_ADDRESS
    );
    expect(value.address).toBe(VISUAL_FIXTURE_ADDRESS);
    expect(Number(result(value, 'eth_chainId'))).toBe(VISUAL_FIXTURE_CHAIN_ID);
    expect(result(value, 'net_version')).toBe(String(VISUAL_FIXTURE_CHAIN_ID));
    expect(
      BigInt(
        result(value, 'eth_getBalance', [value.address, 'latest']) as string
      )
    ).toBe(BigInt(value.balanceWei));
    expect(BigInt(value.balanceWei)).toBeGreaterThan(BigInt('100000000000000'));
    expect(
      result(value, 'eth_getTransactionCount', [value.address, 'latest'])
    ).toBe('0x1');
    expect(result(value, 'eth_gasPrice')).toBe('0x3b9aca00');
    expect(result(value, 'eth_maxPriorityFeePerGas')).toBe('0x3b9aca00');
    expect(
      result(value, 'eth_getBlockByNumber', ['latest', false])
    ).toMatchObject({
      baseFeePerGas: '0x3b9aca00',
    });
  });

  test('reports code only at the declared infrastructure and keeps the owner undeployed', () => {
    const value = fixture();
    expect(result(value, 'eth_getCode', [value.address, 'latest'])).toBe('0x');
    expect(
      result(value, 'eth_getCode', [PALI_CREATE2_DEPLOYER_ADDRESS, 'latest'])
    ).not.toBe('0x');
    for (const contract of value.infrastructure) {
      const code = result(value, 'eth_getCode', [contract.address, 'latest']);
      if (contract.optional) expect(code).toBe('0x');
      else expect(code).not.toBe('0x');
    }
  });

  test('executes canonical factory reads for the same deterministic smart account', () => {
    const value = fixture();
    const validator = value.infrastructure.find(
      (contract) => contract.id === 'ecdsaValidator'
    )!;
    expect(validator).toBeDefined();
    const ownerData = encodeEcdsaValidatorInitData([value.address], 1);
    const initRequest = paliSmartAccountFactoryInterface.encodeFunctionData(
      'getInitData(address,bytes)',
      [validator.address, ownerData]
    );
    const initResponse = result(value, 'eth_call', [
      { to: value.factory.address, data: initRequest },
      'latest',
    ]) as string;
    const [initData] = paliSmartAccountFactoryInterface.decodeFunctionResult(
      'getInitData(address,bytes)',
      initResponse
    );
    const modules = abi.decode(
      [
        'tuple(address module,bytes data)[]',
        'tuple(address module,bytes data)[]',
        'tuple(address module,bytes data)',
        'tuple(address module,bytes data)[]',
      ],
      initData
    );
    expect(modules[0].length).toBe(1);
    expect(modules[0][0][0].toLowerCase()).toBe(
      validator.address.toLowerCase()
    );
    expect(modules[0][0][1]).toBe(ownerData);
    expect(modules[1].length).toBe(0);
    expect(modules[3].length).toBe(0);
    const salt = getPaliSmartAccountDeploymentSalt({
      accountIndex: 0,
      anchor: `pali:eip155:${VISUAL_FIXTURE_CHAIN_ID}:${value.address.toLowerCase()}:smart-account-v1`,
      chainId: VISUAL_FIXTURE_CHAIN_ID,
      factoryAddress: value.factory.address,
    });
    const addressData = paliSmartAccountFactoryInterface.encodeFunctionData(
      'getAddress(bytes32,bytes)',
      [salt, initData]
    );
    const response = result(value, 'eth_call', [
      { to: value.factory.address, data: addressData },
      'latest',
    ]) as string;
    const [address] = paliSmartAccountFactoryInterface.decodeFunctionResult(
      'getAddress(bytes32,bytes)',
      response
    );
    const initialize = new Interface([
      'function initializeAccount(bytes initCode)',
    ]).encodeFunctionData('initializeAccount', [initData]);
    const expected = getCreate2Address(
      value.factory.address,
      salt,
      keccak256(
        concat([
          value.proxyCreationCode,
          abi.encode(
            ['address', 'bytes'],
            [value.implementation.address, initialize]
          ),
        ])
      )
    );
    expect(address).toBe(expected);
    expect(address).toBe('0x51A1459ad911dE3b4BD9ae8A8AD324480519f81F');
    expect(address).not.toBe(value.address);
    expect(result(value, 'eth_getCode', [address, 'latest'])).toBe('0x');
    expect(result(value, 'eth_getBalance', [address, 'latest'])).toBe('0x0');
    expect(result(value, 'eth_getTransactionCount', [address, 'latest'])).toBe(
      '0x0'
    );
  });

  test('provides confirmed native history, empty pending history and matching details', () => {
    const value = fixture();
    const read = (action: string, fields = { address: value.address }) =>
      visualFixtureRead(value, explorer(action, fields), 'GET');
    const history = read('txlist')!.body as {
      result: (typeof value.transaction)[];
      status: string;
    };
    expect(history.status).toBe('1');
    expect(history.result.length).toBeGreaterThan(0);
    expect(history.result[0]).toEqual(value.transaction);
    expect(Number(history.result[0].confirmations)).toBeGreaterThan(0);
    expect(history.result[0].isError).toBe('0');
    expect(history.result[0].txreceipt_status).toBe('1');
    expect(read('pendingtxlist')!.body).toMatchObject({ result: [] });
    expect(read('tokentx')!.body).toMatchObject({ result: [] });
    expect(read('tokenlist')!.body).toMatchObject({ status: '1', result: [] });
    const details = visualFixtureRead(
      value,
      explorer('gettxinfo', { txhash: value.transaction.hash }),
      'GET'
    );
    expect(details!.body).toMatchObject({
      status: '1',
      result: value.transaction,
    });
    expect(
      visualFixtureRead(
        value,
        explorer('gettxinfo', { txhash: `0x${'ff'.repeat(32)}` }),
        'GET'
      )
    ).toBeUndefined();
  });

  test('keeps historical blocks, receipts and explorer rows coherent', () => {
    const value = fixture();
    const latest = result(value, 'eth_getBlockByNumber', [
      'latest',
      false,
    ]) as Record<string, any>;
    const historical = result(value, 'eth_getBlockByHash', [
      value.transaction.blockHash,
      false,
    ]) as Record<string, any>;
    expect(latest.number).toBe('0x2b');
    expect(historical.number).toBe('0x2a');
    expect(historical.hash).toBe(value.transaction.blockHash);
    expect(latest.hash).not.toBe(historical.hash);
    expect(latest.parentHash).toBe(historical.hash);
    expect(result(value, 'eth_getBlockByHash', [latest.hash, false])).toEqual(
      latest
    );
    expect(result(value, 'eth_getBlockByNumber', ['0x2a', false])).toEqual(
      historical
    );
    expect(historical.transactions).toEqual(
      value.transactions.map((row) => row.hash)
    );
    const fullBlock = result(value, 'eth_getBlockByNumber', [
      '0x2a',
      true,
    ]) as Record<string, any>;
    for (const [index, row] of value.transactions.entries()) {
      const rpcTransaction = result(value, 'eth_getTransactionByHash', [
        row.hash,
      ]) as Record<string, any>;
      const receipt = result(value, 'eth_getTransactionReceipt', [
        row.hash,
      ]) as Record<string, any>;
      expect(fullBlock.transactions[index]).toEqual(rpcTransaction);
      expect(rpcTransaction.hash).toBe(row.hash);
      expect(rpcTransaction.blockHash).toBe(historical.hash);
      expect(rpcTransaction.blockNumber).toBe(historical.number);
      expect(BigInt(rpcTransaction.nonce)).toBe(BigInt(row.nonce));
      expect(BigInt(rpcTransaction.value)).toBe(BigInt(row.value));
      expect(BigInt(rpcTransaction.transactionIndex)).toBe(BigInt(index));
      expect(receipt.transactionHash).toBe(row.hash);
      expect(receipt.blockHash).toBe(historical.hash);
      expect(receipt.blockNumber).toBe(historical.number);
      expect(receipt.transactionIndex).toBe(rpcTransaction.transactionIndex);
      expect(receipt.status).toBe('0x1');
      expect(BigInt(receipt.gasUsed)).toBe(BigInt(row.gasUsed));
      expect(BigInt(receipt.cumulativeGasUsed)).toBe(
        BigInt(index + 1) * BigInt(row.gasUsed)
      );
      expect(
        Number(BigInt(latest.number) - BigInt(historical.number)) + 1
      ).toBe(Number(row.confirmations));
    }
    expect(BigInt(historical.gasUsed)).toBe(
      BigInt(value.transactions.length) * BigInt(value.transaction.gasUsed)
    );
    const unknownHash = `0x${'ff'.repeat(32)}`;
    expect(
      result(value, 'eth_getBlockByHash', [unknownHash, false])
    ).toBeNull();
    expect(result(value, 'eth_getTransactionByHash', [unknownHash])).toBeNull();
    expect(
      result(value, 'eth_getTransactionReceipt', [unknownHash])
    ).toBeNull();
  });

  test('refuses lookalike origins, credentials and unexpected methods', () => {
    const value = fixture();
    for (const url of [
      'https://rpc-zk.tanenbaum.io.evil.invalid/',
      'https://rpc-zk.tanenbaum.io:8443/',
      'http://rpc-zk.tanenbaum.io/',
      'https://user:secret@rpc-zk.tanenbaum.io/',
      `${rpcUrl}unexpected`,
      `${rpcUrl}#fragment`,
    ])
      expect(
        visualFixtureRead(value, url, 'POST', rpc('eth_chainId'))
      ).toBeUndefined();
    for (const method of ['GET', 'PUT', 'DELETE'])
      expect(
        visualFixtureRead(value, rpcUrl, method, rpc('eth_chainId'))
      ).toBeUndefined();
  });

  test('never turns unknown RPCs or writes into successful fixture responses', () => {
    const value = fixture();
    for (const method of [
      'eth_sendRawTransaction',
      'eth_sendTransaction',
      'eth_sign',
      'personal_sign',
      'wallet_sendCalls',
      'sys_signAndSend',
      'anvil_setBalance',
      'evm_mine',
      'unknown_read',
    ]) {
      const response = visualFixtureRead(value, rpcUrl, 'POST', rpc(method));
      expect(response?.reads || []).toEqual([]);
      if (response) {
        expect(response.unsupported).toContain(method);
        expect(response.body).toMatchObject({ error: { code: -32601 } });
        expect(response.body).not.toHaveProperty('result');
      }
    }
  });

  test('rejects malformed RPC requests without classifying them as successful reads', () => {
    const value = fixture();
    for (const payload of [
      null,
      {},
      rpc('eth_chainId', [] as unknown[], 1).method,
      { ...rpc('eth_chainId'), params: null },
      { ...rpc('eth_chainId'), jsonrpc: '1.0' },
      { ...rpc('eth_chainId'), method: 17 },
      [],
    ]) {
      const response = visualFixtureRead(value, rpcUrl, 'POST', payload);
      expect(response?.reads || []).toEqual([]);
      if (response) expect(response.unsupported?.length).toBeGreaterThan(0);
    }
    const mixed = visualFixtureRead(value, rpcUrl, 'POST', [
      rpc('eth_chainId'),
      { method: 'eth_getBalance' },
    ]);
    expect(mixed?.unsupported?.length).toBeGreaterThan(0);
  });

  test('refuses arbitrary recipient simulations and explorer account reads', () => {
    const value = fixture();
    const estimate = visualFixtureRead(
      value,
      rpcUrl,
      'POST',
      rpc('eth_estimateGas', [
        { from: value.address, to: foreignAddress, value: '0x1' },
      ])
    );
    expect(estimate?.reads || []).toEqual([]);
    if (estimate) expect(estimate.unsupported).toContain('eth_estimateGas');
    const invalidFactoryCall = visualFixtureRead(
      value,
      rpcUrl,
      'POST',
      rpc('eth_call', [
        {
          to: value.factory.address,
          data: paliSmartAccountFactoryInterface.encodeFunctionData(
            'getInitData(address,bytes)',
            [foreignAddress, '0x']
          ),
        },
        'latest',
      ])
    );
    expect(invalidFactoryCall?.reads || []).toEqual([]);
    if (invalidFactoryCall)
      expect(invalidFactoryCall.unsupported).toContain('eth_call');
    expect(
      visualFixtureRead(
        value,
        explorer('txlist', { address: foreignAddress }),
        'GET'
      )
    ).toBeUndefined();
  });

  test('browser interception blocks writes and unknown requests without forwarding', async () => {
    const value = fixture();
    let handler: ((route: any) => Promise<unknown>) | undefined;
    const context = {
      route: async (_url: string, callback: typeof handler) => {
        handler = callback;
      },
    };
    const audit = await installVisualFixtureRoutes(
      context as unknown as BrowserContext,
      value,
      'http://127.0.0.1:43210'
    );
    const outcomes: string[] = [];
    const request = async (url: string, method: string, payload?: unknown) => {
      await handler!({
        request: () => ({
          url: () => url,
          method: () => method,
          postDataJSON: () => payload,
        }),
        abort: async () => {
          outcomes.push('abort');
        },
        continue: async () => {
          outcomes.push('continue');
        },
        fulfill: async () => {
          outcomes.push('fulfill');
        },
      });
    };
    await request(rpcUrl, 'POST', rpc('eth_sendRawTransaction', ['0xdead']));
    await request('https://unknown.invalid/', 'GET');
    expect(outcomes).toEqual(['abort', 'abort']);
    expect(audit.deniedWrites).toEqual(['eth_sendRawTransaction']);
    expect(audit.deniedUnknown).toEqual(['GET https://unknown.invalid/']);
    expect(audit.reads).toEqual([]);
  });
});
