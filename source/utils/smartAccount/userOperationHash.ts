import { TypedDataEncoder } from 'utils/ethersV6Compat';

import type { SmartAccountPackedUserOperation } from './account';
import { getPaliEntryPointAddress } from './contracts';

// EntryPoint v0.9 uses this EIP-712 type, not the v0.7 abi.encode hash.
// Keep the signing intent local: an RPC getUserOpHash response is not trusted
// input to raw owner signing.
const PACKED_USER_OPERATION_TYPES = {
  PackedUserOperation: [
    { name: 'sender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'initCode', type: 'bytes' },
    { name: 'callData', type: 'bytes' },
    { name: 'accountGasLimits', type: 'bytes32' },
    { name: 'preVerificationGas', type: 'uint256' },
    { name: 'gasFees', type: 'bytes32' },
    { name: 'paymasterAndData', type: 'bytes' },
  ],
};

export const getSmartAccountUserOpHash = (
  userOperation: SmartAccountPackedUserOperation,
  chainId: number
): string => {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error('Smart account signing requires a valid chain ID');
  }
  // Pali builds self-funded factory operations. EntryPoint v0.9 has special
  // hash rules for paymaster signature suffixes and EIP-7702 delegates, which
  // must not silently fall through to ordinary bytes hashing.
  if (userOperation.paymasterAndData !== '0x') {
    throw new Error('Paymaster UserOperations are not supported');
  }
  const initCodePrefix = userOperation.initCode
    .slice(2, 42)
    .padEnd(40, '0')
    .toLowerCase();
  if (initCodePrefix === `7702${'0'.repeat(36)}`) {
    throw new Error('EIP-7702 UserOperations are not supported');
  }

  return TypedDataEncoder.hash(
    {
      chainId,
      name: 'ERC4337',
      verifyingContract: getPaliEntryPointAddress(chainId),
      version: '1',
    },
    PACKED_USER_OPERATION_TYPES,
    userOperation
  );
};
