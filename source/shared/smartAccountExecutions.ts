import { AbiCoder } from 'ethers/abi';
import { getAddress } from 'ethers/address';

import {
  ERC7579_MODE_BATCH_DEFAULT,
  ERC7579_MODE_SINGLE_DEFAULT,
  type SmartAccountExecution,
} from '../utils/smartAccount/account.ts';
import { paliSmartAccountInterface } from '../utils/smartAccount/contracts.ts';

export function decodeSmartAccountExecutions(
  callData: string
): readonly Readonly<SmartAccountExecution>[] | undefined {
  try {
    const [mode, payload] = paliSmartAccountInterface.decodeFunctionData(
      'execute',
      callData
    );
    if (
      paliSmartAccountInterface
        .encodeFunctionData('execute', [mode, payload])
        .toLowerCase() !== callData.toLowerCase()
    )
      return;
    if (mode === ERC7579_MODE_SINGLE_DEFAULT && payload.length >= 106)
      return Object.freeze([
        Object.freeze({
          target: getAddress('0x' + payload.slice(2, 42)),
          value: BigInt('0x' + payload.slice(42, 106)).toString(),
          data: '0x' + payload.slice(106),
        }),
      ]);
    if (mode === ERC7579_MODE_BATCH_DEFAULT) {
      const abi = AbiCoder.defaultAbiCoder(),
        types = ['tuple(address target,uint256 value,bytes callData)[]'];
      const decoded = abi.decode(types, payload);
      if (
        !decoded[0].length ||
        decoded[0].length > 50 ||
        abi.encode(types, decoded).toLowerCase() !== payload.toLowerCase()
      )
        return;
      return Object.freeze(
        decoded[0].map(
          (call: { callData: string; target: string; value: bigint }) =>
            Object.freeze({
              target: getAddress(call.target),
              value: call.value.toString(),
              data: call.callData,
            })
        )
      );
    }
  } catch {
    /* Unknown account methods stay inspectable as contract calls. */
  }
}

export function isSmartAccountNativeRecipient(
  callData: string,
  address: string
): boolean {
  return (
    decodeSmartAccountExecutions(callData)?.some(
      (call) =>
        call.target.toLowerCase() === address.toLowerCase() &&
        BigInt(call.value) > BigInt(0)
    ) ?? false
  );
}

/** Senders observe their whole group; native recipients only the paying operations. */
export function filterSmartAccountNativeRecipientOperations<
  T extends { account: string; callData: string }
>(operations: readonly T[], address: string): readonly T[] {
  return operations.filter(
    (operation) =>
      operation.account.toLowerCase() === address.toLowerCase() ||
      isSmartAccountNativeRecipient(operation.callData, address)
  );
}
