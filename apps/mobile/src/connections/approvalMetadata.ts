import type { ApprovalContractMetadata } from '../../../../source/shared/approval.ts';
import {
  createErc20Reader,
  createSelectedNftReadOperation,
} from '../portfolio/erc20ReadRpc.ts';
import { guardedRead } from '../custody/evmFeeContracts.ts';
import type { NativeNetworkRegistration } from '../custody/networkContext.ts';

/** Optional display enrichment through the existing owned token-read adapters. */
export async function readNativeApprovalMetadata(
  input: Readonly<{
    network: NativeNetworkRegistration;
    owner: string;
    contract: string;
    signal: AbortSignal;
    assertCurrent(): void;
    fetch: (url: string, init: RequestInit) => Promise<Response>;
  }>
): Promise<ApprovalContractMetadata | undefined> {
  const { network, owner, contract, signal, fetch } = input;
  const check = () => {
    guardedRead(input.assertCurrent);
    if (signal.aborted) throw new Error('CANCELLED');
  };
  const options = { fetch, registrations: () => [network] };
  check();
  try {
    const standard = await createSelectedNftReadOperation(options)(
      network.id,
      owner,
      contract,
      signal,
      check,
      async ({ call }) => {
        const standards: ('ERC-721' | 'ERC-1155')[] = [];
        for (const [id, name] of [
          ['80ac58cd', 'ERC-721'],
          ['d9b67a26', 'ERC-1155'],
        ] as const) {
          const response = await call(`0x01ffc9a7${id.padEnd(64, '0')}`);
          check();
          if (
            response.kind === 'result' &&
            response.data === `0x${'0'.repeat(63)}1`
          )
            standards.push(name);
        }
        return standards.length > 1 ? 'ambiguous' as const : standards[0];
      }
    );
    check();
    if (standard === 'ambiguous') return undefined;
    if (standard) return Object.freeze({ standard });
  } catch {
    check();
  }
  try {
    const { metadata } = await createErc20Reader(options).readToken(
      network.id,
      owner,
      contract,
      signal
    );
    check();
    return Object.freeze({ standard: 'ERC-20', token: metadata });
  } catch {
    check();
    return undefined;
  }
}
