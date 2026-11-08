import { getAddress } from '../ethersV6Compat.ts';
import { paliEntryPointInterface } from './contracts.ts';

/** Shared EntryPoint outcome decoding for native and extension history. */
export function decodeSmartAccountUserOperationEvent(log: {
  topics: readonly string[];
  data: string;
}) {
  if (
    !Array.isArray(log.topics) ||
    log.topics.length !== 4 ||
    log.topics.some(
      (topic) => typeof topic !== 'string' || !/^0x[0-9a-f]{64}$/i.test(topic)
    ) ||
    typeof log.data !== 'string' ||
    !/^0x[0-9a-f]{256}$/i.test(log.data)
  )
    throw new Error('Invalid UserOperation event');
  const parsed = paliEntryPointInterface.parseLog({
    topics: [...log.topics],
    data: log.data,
  });
  if (!parsed || parsed.name !== 'UserOperationEvent')
    throw new Error('Invalid UserOperation event');
  return Object.freeze({
    operationHash: String(parsed.args.userOpHash).toLowerCase(),
    sender: getAddress(parsed.args.sender),
    nonce: parsed.args.nonce.toString(),
    success: Boolean(parsed.args.success),
  });
}
