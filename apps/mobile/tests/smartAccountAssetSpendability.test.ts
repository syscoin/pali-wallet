import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder, Interface } from 'ethers/abi';
import { assertSmartAccountAssetSpendability } from '../../../source/utils/smartAccount/assetSpendability.ts';
import {
  encodeERC7579Executions,
  type SmartAccountPackedUserOperation,
} from '../../../source/utils/smartAccount/account.ts';
import {
  getPaliEntryPointAddress,
  paliSmartAccountInterface,
} from '../../../source/utils/smartAccount/contracts.ts';
import { encodeErc20Transfer } from '../../../source/shared/erc20.ts';
import { EvmAssetStateError } from '../../../source/shared/evmAssetState.ts';

const owner = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const recipient = '0x3333333333333333333333333333333333333333';
const abi = new Interface([
  'function supportsInterface(bytes4) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
  'function ownerOf(uint256) view returns (address)',
  'function transfer(address,uint256) returns (bool)',
  'function transferFrom(address,address,uint256)',
  'function safeTransferFrom(address,address,uint256)',
  'function safeTransferFrom(address,address,uint256,uint256,bytes)',
  'function safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)',
]);
const word = (value: bigint | number) =>
  AbiCoder.defaultAbiCoder().encode(['uint256'], [value]);
const reverted = () =>
  Object.assign(new Error('execution reverted'), { code: 3, data: '0x' });
function operation(
  calls: { target: string; value: string; data?: string }[]
): SmartAccountPackedUserOperation {
  const encoded = encodeERC7579Executions(calls);
  return {
    sender: owner,
    nonce: '0',
    initCode: '0x',
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [
      encoded.mode,
      encoded.executionCalldata,
    ]),
    accountGasLimits: '0x' + '00'.repeat(32),
    preVerificationGas: '0',
    gasFees: '0x' + '00'.repeat(32),
    paymasterAndData: '0x',
    signature: '0x',
  };
}
function fixture(
  standard: 'ERC20' | 'ERC721' | 'ERC1155' | 'unknown' = 'ERC1155'
) {
  const state = {
    balance: 12n,
    owner,
    current: true,
    deployed: true,
    falseReturn: false,
    executionFailure: false,
    verifies: 0,
  };
  const calls: { method: string; params: any[] }[] = [];
  let before: (() => void | Promise<void>) | undefined;
  const provider = {
    async verifyConfiguredChainId() {
      state.verifies++;
    },
    async send(method: string, params: any[]) {
      calls.push({ method, params });
      await before?.();
      assert.equal(params[1], 'pending');
      if (method === 'eth_getCode')
        return params[0] === owner && !state.deployed ? '0x' : '0x6000';
      const call = params[0];
      if (call.to === owner) {
        assert.equal(call.from, getPaliEntryPointAddress(1));
        if (state.executionFailure) throw reverted();
        return '0x';
      }
      const parsed = abi.parseTransaction({ data: call.data });
      assert(parsed);
      if (parsed.name === 'supportsInterface')
        return word(
          (standard === 'ERC1155' && parsed.args[0] === '0xd9b67a26') ||
            (standard === 'ERC721' && parsed.args[0] === '0x80ac58cd')
            ? 1
            : 0
        );
      if (standard === 'unknown' && !call.from) throw reverted();
      if (parsed.name === 'decimals')
        return standard === 'ERC20' ? word(18) : '0x';
      if (parsed.name === 'balanceOf')
        return word(
          parsed.args.length === 1 || parsed.args[1] === 7n ? state.balance : 0
        );
      if (parsed.name === 'balanceOfBatch')
        return abi.encodeFunctionResult(parsed.fragment, [[state.balance]]);
      if (parsed.name === 'ownerOf') {
        if (parsed.args[0] !== 7n) throw reverted();
        return abi.encodeFunctionResult(parsed.fragment, [state.owner]);
      }
      if (state.executionFailure) throw reverted();
      return standard === 'ERC20' ? word(state.falseReturn ? 0 : 1) : '0x';
    },
  };
  return {
    state,
    calls,
    provider,
    before(fn: () => void | Promise<void>) {
      before = fn;
    },
    check() {
      assert(state.current, 'cancelled');
    },
  };
}
const nftCall = (amount: string) => ({
  target: token,
  value: '0',
  data: abi.encodeFunctionData(
    'safeTransferFrom(address,address,uint256,uint256,bytes)',
    [owner, recipient, 7, amount, '0x']
  ),
});
const run = (
  f: ReturnType<typeof fixture>,
  op: SmartAccountPackedUserOperation
) =>
  assertSmartAccountAssetSpendability({
    provider: f.provider,
    chainId: 1,
    userOperation: op,
    assertCurrent: f.check,
  });

test('verified ERC1155 shortfall retains its typed reason and extension message before simulation', async () => {
  const f = fixture();
  f.state.balance = 10n;
  await assert.rejects(run(f, operation([nftCall('11')])), error => {
    assert(error instanceof EvmAssetStateError);
    assert.equal(error.code, 'INSUFFICIENT_ASSET');
    assert.equal(error.message, 'Insufficient token or collectible balance');
    assert.equal((error as EvmAssetStateError & { transactionNotBroadcast?: boolean }).transactionNotBroadcast, true);
    return true;
  });
  assert.equal(f.calls.some(call => call.method === 'eth_call' && call.params[0].from === owner), false);
});

test('ERC1155 shared guard sees the changed exact balance instead of an earlier UI balance', async () => {
  const f = fixture();
  await run(f, operation([nftCall('5')]));
  f.state.balance = 7n;
  await assert.rejects(
    run(f, operation([nftCall('8')])),
    /Insufficient token or collectible balance/
  );
  await run(f, operation([nftCall('7')]));
  assert.equal(
    f.calls.some((call) => call.method === 'eth_getTransactionCount'),
    false
  );
});
test('ERC721 ownership and exact ERC20 units are checked through the same shared reader', async () => {
  const nft = fixture('ERC721'),
    erc20 = fixture('ERC20');
  const call = {
    target: token,
    value: '0',
    data: abi.encodeFunctionData('safeTransferFrom(address,address,uint256)', [
      owner,
      recipient,
      7,
    ]),
  };
  await run(nft, operation([call]));
  nft.state.owner = recipient;
  await assert.rejects(
    run(nft, operation([call])),
    /Insufficient token or collectible balance/
  );
  erc20.state.balance = 9007199254740993n;
  await run(
    erc20,
    operation([
      {
        target: token,
        value: '0',
        data: encodeErc20Transfer(recipient, '9007199254740993'),
      },
    ])
  );
  await assert.rejects(
    run(
      erc20,
      operation([
        {
          target: token,
          value: '0',
          data: encodeErc20Transfer(recipient, '9007199254740994'),
        },
      ])
    ),
    /Insufficient token or collectible balance/
  );
  erc20.state.falseReturn = true;
  await assert.rejects(
    run(
      erc20,
      operation([
        {
          target: token,
          value: '0',
          data: encodeErc20Transfer(recipient, '1'),
        },
      ])
    ),
    /Asset transfer would fail/
  );
});
test('unknown contracts and unknown transferFrom do not acquire ERC20 amount semantics', async () => {
  const f = fixture('unknown');
  await run(
    f,
    operation([
      {
        target: token,
        value: '0',
        data: encodeErc20Transfer(recipient, '123'),
      },
    ])
  );
  await run(
    f,
    operation([
      {
        target: token,
        value: '0',
        data: abi.encodeFunctionData('transferFrom', [owner, recipient, 999]),
      },
    ])
  );
  assert.equal(
    f.calls.filter((call) => call.method === 'eth_call' && call.params[0].from)
      .length,
    0
  );
  const legacyNft = fixture('ERC721');
  await run(
    legacyNft,
    operation([
      {
        target: token,
        value: '0',
        data: encodeErc20Transfer(recipient, '999'),
      },
    ])
  );
  assert.equal(
    legacyNft.calls.some(
      (call) => call.method === 'eth_call' && call.params[0].from
    ),
    false
  );
});
test('a generic transfer/balanceOf overlap without valid ERC20 decimals keeps its normal contract path', async () => {
  for (const decimals of ['0x', '0x01', word(256), null]) {
    const f = fixture('ERC20');
    f.state.balance = 1n;
    f.state.executionFailure = true;
    const send = f.provider.send.bind(f.provider);
    f.provider.send = async (method, params) => {
      if (method === 'eth_call' && params[0]?.data === '0x313ce567') {
        if (decimals === null) throw reverted();
        return decimals;
      }
      return send(method, params);
    };
    await run(
      f,
      operation([
        {
          target: token,
          value: '0',
          data: encodeErc20Transfer(recipient, '999'),
        },
      ])
    );
    assert(f.calls.some((call) => call.params[0]?.data?.startsWith('0x70a08231')));
    assert.equal(
      f.calls.some((call) => call.method === 'eth_call' && call.params[0].from),
      false
    );
    assert.equal(f.calls.some((call) => call.method === 'eth_getCode'), false);
  }
});
test('a deployed ordered batch is simulated together rather than rejected using summed or early holdings', async () => {
  const f = fixture();
  f.state.balance = 0n;
  const op = operation([nftCall('5'), nftCall('8')]);
  await run(f, op);
  const simulations = f.calls.filter(
    (call) => call.method === 'eth_call' && call.params[0].to === owner
  );
  assert.equal(simulations.length, 1);
  assert.equal(simulations[0]!.params[0].data, op.callData);
  f.state.executionFailure = true;
  await assert.rejects(run(f, op), /execution reverted/);
});
test('counterfactual batches preserve the existing handleOps path without inventing a blanket ban', async () => {
  const f = fixture();
  f.state.deployed = false;
  f.state.balance = 0n;
  await run(f, operation([nftCall('5'), nftCall('8')]));
  assert.equal(
    f.calls.some(
      (call) => call.method === 'eth_call' && call.params[0].to === owner
    ),
    false
  );
});
test('a mixed unknown-contract batch keeps the existing path without a tx.origin-changing simulation', async () => {
  const f = fixture();
  f.state.executionFailure = true;
  await run(
    f,
    operation([
      { target: recipient, value: '0', data: '0x12345678' },
      nftCall('8'),
    ])
  );
  assert.equal(
    f.calls.some(
      (call) => call.method === 'eth_call' && call.params[0].to === owner
    ),
    false
  );
});
test('a maximum-size ERC1155 ID list uses one exact contract simulation without per-ID RPCs', async () => {
  const f = fixture();
  const ids = Array.from({ length: 128 }, (_, index) => index),
    amounts = ids.map(() => 1);
  const call = {
    target: token,
    value: '0',
    data: abi.encodeFunctionData('safeBatchTransferFrom', [
      owner,
      recipient,
      ids,
      amounts,
      '0x',
    ]),
  };
  await run(f, operation([call]));
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1]!.params[0].data, call.data);
  f.state.executionFailure = true;
  await assert.rejects(run(f, operation([call])), /execution reverted/);
});
test('cancellation after a pending read cannot release a successful asset check', async () => {
  const f = fixture();
  f.before(() => {
    f.state.current = false;
  });
  await assert.rejects(run(f, operation([nftCall('1')])), /cancelled/);
});
