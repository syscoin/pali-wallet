import { Interface } from 'utils/ethersV6Compat';

import { getBlacklistTargetsForEvmCall } from './evmCallBlacklist';

const TOKEN = '0x1111111111111111111111111111111111111111';
const SPENDER = '0x2222222222222222222222222222222222222222';
const OPERATOR = '0x3333333333333333333333333333333333333333';
const RECIPIENT = '0x4444444444444444444444444444444444444444';

const ERC20_INTERFACE = new Interface([
  'function approve(address spender,uint256 amount)',
  'function decreaseAllowance(address spender,uint256 subtractedValue)',
  'function increaseAllowance(address spender,uint256 addedValue)',
]);

const ERC721_INTERFACE = new Interface([
  'function setApprovalForAll(address operator,bool approved)',
]);

const ERC1155_INTERFACE = new Interface([
  'function safeBatchTransferFrom(address from,address to,uint256[] ids,uint256[] amounts,bytes data)',
]);

describe('getBlacklistTargetsForEvmCall', () => {
  it('includes the direct target and ERC20 approval spender', () => {
    const targets = getBlacklistTargetsForEvmCall({
      data: ERC20_INTERFACE.encodeFunctionData('approve', [SPENDER, 1]),
      to: TOKEN,
    });

    expect(targets).toEqual([
      { address: TOKEN, type: 'target' },
      { address: SPENDER, method: 'approve', type: 'approval' },
    ]);
  });

  it('allows ERC20 allowance reductions and revocations', () => {
    const revokeTargets = getBlacklistTargetsForEvmCall({
      data: ERC20_INTERFACE.encodeFunctionData('approve', [SPENDER, 0]),
      tokenStandard: 'ERC-20',
      to: TOKEN,
    });
    expect(revokeTargets).toEqual([{ address: TOKEN, type: 'target' }]);

    const decreaseTargets = getBlacklistTargetsForEvmCall({
      data: ERC20_INTERFACE.encodeFunctionData('decreaseAllowance', [
        SPENDER,
        1,
      ]),
      to: TOKEN,
    });
    expect(decreaseTargets).toEqual([{ address: TOKEN, type: 'target' }]);

    const zeroIncreaseTargets = getBlacklistTargetsForEvmCall({
      data: ERC20_INTERFACE.encodeFunctionData('increaseAllowance', [
        SPENDER,
        0,
      ]),
      to: TOKEN,
    });
    expect(zeroIncreaseTargets).toEqual([{ address: TOKEN, type: 'target' }]);
  });

  it('does not treat unknown zero approve calls as ERC20 revocations', () => {
    const targets = getBlacklistTargetsForEvmCall({
      data: ERC20_INTERFACE.encodeFunctionData('approve', [SPENDER, 0]),
      to: TOKEN,
    });

    expect(targets).toEqual([
      { address: TOKEN, type: 'target' },
      { address: SPENDER, method: 'approve', type: 'approval' },
    ]);
  });

  it('includes approved NFT operators but ignores revocations', () => {
    const approvalTargets = getBlacklistTargetsForEvmCall({
      data: ERC721_INTERFACE.encodeFunctionData('setApprovalForAll', [
        OPERATOR,
        true,
      ]),
    });
    expect(approvalTargets).toEqual([
      { address: OPERATOR, method: 'setApprovalForAll', type: 'approval' },
    ]);

    const revokeTargets = getBlacklistTargetsForEvmCall({
      data: ERC721_INTERFACE.encodeFunctionData('setApprovalForAll', [
        OPERATOR,
        false,
      ]),
    });
    expect(revokeTargets).toEqual([]);
  });

  it('extracts ERC1155 batch transfer recipients', () => {
    const targets = getBlacklistTargetsForEvmCall({
      data: ERC1155_INTERFACE.encodeFunctionData('safeBatchTransferFrom', [
        SPENDER,
        RECIPIENT,
        [1, 2],
        [10, 20],
        '0x',
      ]),
      to: TOKEN,
    });

    expect(targets).toEqual([
      { address: TOKEN, type: 'target' },
      {
        address: RECIPIENT,
        method: 'safeBatchTransferFrom',
        type: 'token-recipient',
      },
    ]);
  });
});
