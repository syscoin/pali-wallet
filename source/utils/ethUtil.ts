import InputDataDecoder from 'ethereum-input-data-decoder';

import { getErc20Abi } from '@pollum-io/sysweb3-utils';

import { ITransactionParams } from 'types/transactions';

export const erc20DataDecoder = () => new InputDataDecoder(getErc20Abi());

export const decodeTransactionData = (params: ITransactionParams) => {
  try {
    const { data, value } = params;

    if (data && !value) {
      const decoderValue = erc20DataDecoder().decodeData(params.data);

      if (decoderValue.method === null) {
        decoderValue.method = 'Contract Interaction';
      }

      return decoderValue;
    }

    if (data && value) {
      const testAbi = [
        {
          inputs: [
            {
              internalType: 'address',
              name: '_factory',
              type: 'address',
            },
            {
              internalType: 'address',
              name: '_WSYS',
              type: 'address',
            },
          ],
          stateMutability: 'nonpayable',
          type: 'constructor',
        },
        {
          inputs: [],
          name: 'WSYS',
          outputs: [
            {
              internalType: 'address',
              name: '',
              type: 'address',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'address',
              name: 'tokenA',
              type: 'address',
            },
            {
              internalType: 'address',
              name: 'tokenB',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'amountADesired',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountBDesired',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountAMin',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountBMin',
              type: 'uint256',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'addLiquidity',
          outputs: [
            {
              internalType: 'uint256',
              name: 'amountA',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountB',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'liquidity',
              type: 'uint256',
            },
          ],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'address',
              name: 'token',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'amountTokenDesired',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountTokenMin',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountSYSMin',
              type: 'uint256',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'addLiquiditySYS',
          outputs: [
            {
              internalType: 'uint256',
              name: 'amountToken',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountSYS',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'liquidity',
              type: 'uint256',
            },
          ],
          stateMutability: 'payable',
          type: 'function',
        },
        {
          inputs: [],
          name: 'factory',
          outputs: [
            {
              internalType: 'address',
              name: '',
              type: 'address',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountOut',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'reserveIn',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'reserveOut',
              type: 'uint256',
            },
          ],
          name: 'getAmountIn',
          outputs: [
            {
              internalType: 'uint256',
              name: 'amountIn',
              type: 'uint256',
            },
          ],
          stateMutability: 'pure',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountIn',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'reserveIn',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'reserveOut',
              type: 'uint256',
            },
          ],
          name: 'getAmountOut',
          outputs: [
            {
              internalType: 'uint256',
              name: 'amountOut',
              type: 'uint256',
            },
          ],
          stateMutability: 'pure',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountOut',
              type: 'uint256',
            },
            {
              internalType: 'address[]',
              name: 'path',
              type: 'address[]',
            },
          ],
          name: 'getAmountsIn',
          outputs: [
            {
              internalType: 'uint256[]',
              name: 'amounts',
              type: 'uint256[]',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountIn',
              type: 'uint256',
            },
            {
              internalType: 'address[]',
              name: 'path',
              type: 'address[]',
            },
          ],
          name: 'getAmountsOut',
          outputs: [
            {
              internalType: 'uint256[]',
              name: 'amounts',
              type: 'uint256[]',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountA',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'reserveA',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'reserveB',
              type: 'uint256',
            },
          ],
          name: 'quote',
          outputs: [
            {
              internalType: 'uint256',
              name: 'amountB',
              type: 'uint256',
            },
          ],
          stateMutability: 'pure',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'address',
              name: 'tokenA',
              type: 'address',
            },
            {
              internalType: 'address',
              name: 'tokenB',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'liquidity',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountAMin',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountBMin',
              type: 'uint256',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'removeLiquidity',
          outputs: [
            {
              internalType: 'uint256',
              name: 'amountA',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountB',
              type: 'uint256',
            },
          ],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'address',
              name: 'token',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'liquidity',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountTokenMin',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountSYSMin',
              type: 'uint256',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'removeLiquiditySYS',
          outputs: [
            {
              internalType: 'uint256',
              name: 'amountToken',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountSYS',
              type: 'uint256',
            },
          ],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'address',
              name: 'token',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'liquidity',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountTokenMin',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountSYSMin',
              type: 'uint256',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'removeLiquiditySYSSupportingFeeOnTransferTokens',
          outputs: [
            {
              internalType: 'uint256',
              name: 'amountSYS',
              type: 'uint256',
            },
          ],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'address',
              name: 'token',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'liquidity',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountTokenMin',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountSYSMin',
              type: 'uint256',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
            {
              internalType: 'bool',
              name: 'approveMax',
              type: 'bool',
            },
            {
              internalType: 'uint8',
              name: 'v',
              type: 'uint8',
            },
            {
              internalType: 'bytes32',
              name: 'r',
              type: 'bytes32',
            },
            {
              internalType: 'bytes32',
              name: 's',
              type: 'bytes32',
            },
          ],
          name: 'removeLiquiditySYSWithPermit',
          outputs: [
            {
              internalType: 'uint256',
              name: 'amountToken',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountSYS',
              type: 'uint256',
            },
          ],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'address',
              name: 'token',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'liquidity',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountTokenMin',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountSYSMin',
              type: 'uint256',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
            {
              internalType: 'bool',
              name: 'approveMax',
              type: 'bool',
            },
            {
              internalType: 'uint8',
              name: 'v',
              type: 'uint8',
            },
            {
              internalType: 'bytes32',
              name: 'r',
              type: 'bytes32',
            },
            {
              internalType: 'bytes32',
              name: 's',
              type: 'bytes32',
            },
          ],
          name: 'removeLiquiditySYSWithPermitSupportingFeeOnTransferTokens',
          outputs: [
            {
              internalType: 'uint256',
              name: 'amountSYS',
              type: 'uint256',
            },
          ],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'address',
              name: 'tokenA',
              type: 'address',
            },
            {
              internalType: 'address',
              name: 'tokenB',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'liquidity',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountAMin',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountBMin',
              type: 'uint256',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
            {
              internalType: 'bool',
              name: 'approveMax',
              type: 'bool',
            },
            {
              internalType: 'uint8',
              name: 'v',
              type: 'uint8',
            },
            {
              internalType: 'bytes32',
              name: 'r',
              type: 'bytes32',
            },
            {
              internalType: 'bytes32',
              name: 's',
              type: 'bytes32',
            },
          ],
          name: 'removeLiquidityWithPermit',
          outputs: [
            {
              internalType: 'uint256',
              name: 'amountA',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountB',
              type: 'uint256',
            },
          ],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountOutMin',
              type: 'uint256',
            },
            {
              internalType: 'address[]',
              name: 'path',
              type: 'address[]',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'swapExactSYSForTokens',
          outputs: [
            {
              internalType: 'uint256[]',
              name: 'amounts',
              type: 'uint256[]',
            },
          ],
          stateMutability: 'payable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountOutMin',
              type: 'uint256',
            },
            {
              internalType: 'address[]',
              name: 'path',
              type: 'address[]',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'swapExactSYSForTokensSupportingFeeOnTransferTokens',
          outputs: [],
          stateMutability: 'payable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountIn',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountOutMin',
              type: 'uint256',
            },
            {
              internalType: 'address[]',
              name: 'path',
              type: 'address[]',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'swapExactTokensForSYS',
          outputs: [
            {
              internalType: 'uint256[]',
              name: 'amounts',
              type: 'uint256[]',
            },
          ],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountIn',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountOutMin',
              type: 'uint256',
            },
            {
              internalType: 'address[]',
              name: 'path',
              type: 'address[]',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'swapExactTokensForSYSSupportingFeeOnTransferTokens',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountIn',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountOutMin',
              type: 'uint256',
            },
            {
              internalType: 'address[]',
              name: 'path',
              type: 'address[]',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'swapExactTokensForTokens',
          outputs: [
            {
              internalType: 'uint256[]',
              name: 'amounts',
              type: 'uint256[]',
            },
          ],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountIn',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountOutMin',
              type: 'uint256',
            },
            {
              internalType: 'address[]',
              name: 'path',
              type: 'address[]',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountOut',
              type: 'uint256',
            },
            {
              internalType: 'address[]',
              name: 'path',
              type: 'address[]',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'swapSYSForExactTokens',
          outputs: [
            {
              internalType: 'uint256[]',
              name: 'amounts',
              type: 'uint256[]',
            },
          ],
          stateMutability: 'payable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountOut',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountInMax',
              type: 'uint256',
            },
            {
              internalType: 'address[]',
              name: 'path',
              type: 'address[]',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'swapTokensForExactSYS',
          outputs: [
            {
              internalType: 'uint256[]',
              name: 'amounts',
              type: 'uint256[]',
            },
          ],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [
            {
              internalType: 'uint256',
              name: 'amountOut',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'amountInMax',
              type: 'uint256',
            },
            {
              internalType: 'address[]',
              name: 'path',
              type: 'address[]',
            },
            {
              internalType: 'address',
              name: 'to',
              type: 'address',
            },
            {
              internalType: 'uint256',
              name: 'deadline',
              type: 'uint256',
            },
          ],
          name: 'swapTokensForExactTokens',
          outputs: [
            {
              internalType: 'uint256[]',
              name: 'amounts',
              type: 'uint256[]',
            },
          ],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          stateMutability: 'payable',
          type: 'receive',
        },
      ];

      const decoderInstance = new InputDataDecoder(JSON.stringify(testAbi));

      const decoderValue = decoderInstance.decodeData(params.data);

      return decoderValue;
    }
  } catch (error) {
    console.log('error decode', error);

    return;
  }
};
