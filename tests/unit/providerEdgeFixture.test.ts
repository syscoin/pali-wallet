import { AbiCoder, id } from 'ethers';

import {
  EDGE_PENDING_HASH,
  EDGE_RPC_READS,
  EDGE_TOKEN,
  createEdgeTokenRuntime,
  edgeRpcOverride,
} from '../../e2e/harness/providerEdgeFixture';

// Small independent interpreter for only the fixture's read-only opcodes.
// No Anvil, browser, network, key access or transaction execution is needed.
const executeFixture = (calldata: string) => {
  const code = Buffer.from(createEdgeTokenRuntime().slice(2), 'hex');
  const data = Buffer.from(calldata.slice(2).padEnd(64, '0'), 'hex');
  const stack: bigint[] = [];
  let memory = Buffer.alloc(0);
  let pc = 0;
  for (let steps = 0; steps < 200; steps++) {
    const opcode = code[pc++];
    if (opcode >= 0x60 && opcode <= 0x7f) {
      const length = opcode - 0x5f;
      stack.push(BigInt(`0x${code.subarray(pc, pc + length).toString('hex')}`));
      pc += length;
    } else if (opcode === 0x35) {
      const start = Number(stack.pop()!);
      stack.push(
        BigInt(`0x${data.subarray(start, start + 32).toString('hex')}`)
      );
    } else if (opcode === 0x1c) {
      const shift = stack.pop()!;
      stack.push(stack.pop()! >> shift);
    } else if (opcode === 0x80) stack.push(stack[stack.length - 1]);
    else if (opcode === 0x14)
      stack.push(stack.pop() === stack.pop() ? BigInt(1) : BigInt(0));
    else if (opcode === 0x57) {
      const target = Number(stack.pop()!);
      if (stack.pop() !== BigInt(0)) pc = target;
    } else if (opcode === 0x5b) {
      // JUMPDEST
    } else if (opcode === 0x50) stack.pop();
    else if (opcode === 0x39) {
      const destination = Number(stack.pop()!);
      const source = Number(stack.pop()!);
      const length = Number(stack.pop()!);
      memory = Buffer.alloc(destination + length);
      code.copy(memory, destination, source, source + length);
    } else if (opcode === 0xf3) {
      const start = Number(stack.pop()!);
      const length = Number(stack.pop()!);
      return `0x${memory.subarray(start, start + length).toString('hex')}`;
    } else if (opcode === 0xfd) return null;
    else throw new Error(`Unexpected fixture opcode ${opcode}`);
  }
  throw new Error('Fixture did not halt');
};

describe('read-only provider edge fixtures', () => {
  it.each([
    ['name()', 'string', EDGE_TOKEN.name],
    ['symbol()', 'string', EDGE_TOKEN.symbol],
    ['decimals()', 'uint256', BigInt(8)],
    ['balanceOf(address)', 'uint256', BigInt(0)],
    ['totalSupply()', 'uint256', BigInt(0)],
    ['supportsInterface(bytes4)', 'bool', false],
  ])('executes exact ABI metadata for %s', (signature, type, expected) => {
    const result = executeFixture(id(signature as string).slice(0, 10));
    expect(result).not.toBeNull();
    expect(
      AbiCoder.defaultAbiCoder().decode([type as string], result!)[0]
    ).toBe(expected);
  });

  it('reverts an unsupported transfer selector', () => {
    expect(executeFixture('0xa9059cbb')).toBeNull();
  });

  it.each(['eth_syncing', 'net_listening'])(
    'keeps false distinct from no override: %s',
    (method) => {
      expect(edgeRpcOverride(method, [])).toEqual({
        matched: true,
        result: false,
      });
    }
  );

  it('preserves empty string and null without overriding another receipt', () => {
    expect(edgeRpcOverride('web3_clientVersion', [])).toEqual({
      matched: true,
      result: '',
    });
    expect(
      edgeRpcOverride('eth_getTransactionReceipt', [EDGE_PENDING_HASH])
    ).toEqual({ matched: true, result: null });
    expect(
      edgeRpcOverride('eth_getTransactionReceipt', [`0x${'cd'.repeat(32)}`])
    ).toEqual({ matched: false });
  });

  it.each([
    'eth_sendRawTransaction',
    'eth_sendTransaction',
    'wallet_sendCalls',
    'anvil_setCode',
  ])('does not admit browser write method %s', (method) => {
    expect(EDGE_RPC_READS.has(method)).toBe(false);
  });
});
