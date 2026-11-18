import type { ApprovalContractMetadata } from '../../../../source/shared/approval.ts';
import {
  createSelectedAssetReadOperation,
  parseScopedErc20Metadata,
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
    return await createSelectedAssetReadOperation(options)(
      network.id,
      owner,
      contract,
      signal,
      check,
      async ({ call, holder, target }) => {
        const standards: ('ERC-721' | 'ERC-1155')[] = [];
        const interfaces = [
          ['80ac58cd', 'ERC-721'],
          ['d9b67a26', 'ERC-1155'],
        ] as const;
        const observations = await Promise.all(interfaces.map(([id]) =>
          call(`0x01ffc9a7${id.padEnd(64, '0')}`)));
        for (const [index, [, name]] of interfaces.entries()) {
          const response = observations[index]!;
          check();
          if (
            response.kind === 'result' &&
            response.data === `0x${'0'.repeat(63)}1`
          )
            standards.push(name);
        }
        if (standards.length > 1) return undefined;
        if (standards[0]) return Object.freeze({ standard: standards[0] });
        const values = await Promise.all([
          '0x06fdde03', '0x95d89b41', '0x313ce567',
          `0x70a08231${holder.slice(2).toLowerCase().padStart(64, '0')}`,
        ].map(data => call(data)));
        check();
        const data = values.map(value => {
          if (value.kind !== 'result') throw new Error('ERC20 metadata unavailable');
          return value.data;
        });
        return Object.freeze({ standard: 'ERC-20' as const,
          token: parseScopedErc20Metadata(target, data[0], data[1], data[2], data[3]),
        });
      }
    );
  } catch {
    check();
    return undefined;
  }
}
