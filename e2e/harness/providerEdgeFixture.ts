import { AbiCoder, id } from 'ethers';

// Synthetic read-only metadata contract, installed only by anvil_setCode on
// the disposable local chain. It has no transfer, approve or mint handlers.
export const EDGE_TOKEN = {
  address: '0x000000000000000000000000000000000000ed6e',
  decimals: 8,
  name: 'Pali local provider fixture',
  symbol: 'EDGE',
} as const;
export const EDGE_PENDING_HASH = `0x${'ab'.repeat(32)}`;

export function createEdgeTokenRuntime() {
  const abi = AbiCoder.defaultAbiCoder();
  const replies = [
    ['name()', abi.encode(['string'], [EDGE_TOKEN.name])],
    ['symbol()', abi.encode(['string'], [EDGE_TOKEN.symbol])],
    ['decimals()', abi.encode(['uint256'], [EDGE_TOKEN.decimals])],
    ['balanceOf(address)', abi.encode(['uint256'], [0])],
    ['totalSupply()', abi.encode(['uint256'], [0])],
    ['supportsInterface(bytes4)', abi.encode(['bool'], [false])],
  ].map(([signature, encoded]) => ({
    selector: id(signature).slice(2, 10),
    encoded: encoded.slice(2),
  }));
  const word = (value: number) => value.toString(16).padStart(4, '0');
  // CALLDATALOAD(0), SHR(224); one DUP/EQ/JUMPI branch per selector.
  const prefix = '60003560e01c';
  const fallback = '60006000fd';
  const dispatchBytes = prefix.length / 2 + replies.length * 11 + 5;
  const branchBytes = 17;
  const dataStart = dispatchBytes + replies.length * branchBytes;
  let offset = dataStart;
  const dispatch = replies.map(
    (reply, index) =>
      `8063${reply.selector}1461${word(dispatchBytes + index * branchBytes)}57`
  );
  const branches = replies.map((reply) => {
    const length = reply.encoded.length / 2;
    // JUMPDEST, POP selector, CODECOPY bytes into memory, RETURN exact ABI.
    const code = `5b5061${word(length)}61${word(offset)}60003961${word(
      length
    )}6000f3`;
    offset += length;
    return code;
  });
  return `0x${prefix}${dispatch.join('')}${fallback}${branches.join(
    ''
  )}${replies.map((reply) => reply.encoded).join('')}`;
}

export const EDGE_RPC_READS = new Set([
  'eth_chainId',
  'net_version',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getCode',
  'eth_call',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_getLogs',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_syncing',
  'net_listening',
  'net_peerCount',
  'web3_clientVersion',
]);

export function edgeRpcOverride(method: string, params: unknown[]) {
  switch (method) {
    case 'eth_syncing':
    case 'net_listening':
      return { matched: true, result: false };
    case 'net_peerCount':
      return { matched: true, result: '0x0' };
    case 'web3_clientVersion':
      return { matched: true, result: '' };
    case 'eth_getTransactionReceipt':
      if (params?.length === 1 && params[0] === EDGE_PENDING_HASH)
        return { matched: true, result: null };
      break;
    default:
      break;
  }
  return { matched: false };
}
