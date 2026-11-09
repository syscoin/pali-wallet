import { getAddress } from 'ethers/address';
import { getContractType } from '@sidhujag/sysweb3-utils/cjs/getContract.js';
import {
  getNftStandardMetadata,
  getTokenStandardMetadata,
} from '@sidhujag/sysweb3-utils/cjs/tokens.js';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import {
  normalizeDappWalletControl,
  type DappWatchAssetRequest,
} from '../../../../source/shared/dappWalletControl.ts';
import { normalizeNftTokenId } from '../../../../source/utils/nftTokenId.ts';
import {
  getNativeNetwork,
  snapshotNativeNetwork,
} from '../custody/networkContext.ts';
import type {
  NativePreparedDappControl,
  NativeDappControlDetails,
} from '../connections/controlRequests.ts';
import type { PublicCustodySource } from './nativePortfolio.ts';
import type { NativeTokenRuntime } from './nativeTokens.ts';
import { normalizeErc20Address, parseErc20Metadata } from './erc20Metadata.ts';
import {
  createSelectedAssetReadOperation,
  Erc20ReadError,
} from './erc20ReadRpc.ts';
import { snapshotSavedCollectible } from './tokenRegistry.ts';

export type NativeWatchAssetOwner = Readonly<{
  accountId: string;
  networkId: string;
  address: string;
}>;
export type NativeWatchAssetObservation = Extract<
  NativeDappControlDetails,
  { kind: 'watch-asset' }
>;
export type NativeWatchAssetObserver = (
  request: DappWatchAssetRequest,
  owner: NativeWatchAssetOwner,
  signal: AbortSignal,
  assertCurrent: () => void
) => Promise<NativeWatchAssetObservation>;
const changed = () => new Error('CANCELLED');
const invalid = () => new Erc20ReadError('INVALID_RESPONSE');

function snapshotRequest(input: DappWatchAssetRequest): DappWatchAssetRequest {
  if (input.method !== 'wallet_watchAsset') throw invalid();
  return normalizeDappWalletControl('wallet_watchAsset', {
    type: input.type,
    options: { address: input.address, tokenId: input.tokenId },
  }) as DappWatchAssetRequest;
}
function observation(
  request: DappWatchAssetRequest,
  value: NativeWatchAssetObservation
): NativeWatchAssetObservation {
  if (value.kind !== 'watch-asset' || value.type !== request.type)
    throw invalid();
  const metadata = parseErc20Metadata({
    contractAddress: value.address,
    name: value.name,
    symbol: value.symbol,
    decimals: value.decimals,
  });
  if (
    metadata.contractAddress !== normalizeErc20Address(request.address) ||
    (request.type !== 'ERC20' && metadata.decimals !== 0)
  )
    throw invalid();
  const tokenId =
    request.type === 'ERC1155'
      ? normalizeNftTokenId(request.tokenId)
      : undefined;
  if (value.tokenId !== tokenId) throw invalid();
  return Object.freeze({
    kind: 'watch-asset',
    type: request.type,
    address: metadata.contractAddress,
    name: metadata.name,
    symbol: metadata.symbol,
    decimals: metadata.decimals,
    ...(tokenId === undefined ? {} : { tokenId }),
  });
}

/** Existing SDK type/metadata readers, confined to one sampled contract and bounded native RPC. */
export function createNativeWatchAssetObserver(
  options: Parameters<typeof createSelectedAssetReadOperation>[0]
): NativeWatchAssetObserver {
  const observe = createSelectedAssetReadOperation(options);
  return async (input, owner, signal, assertCurrent) => {
    const request = snapshotRequest(input);
    const check = () => {
      if (signal.aborted) throw changed();
      assertSynchronousEvmFeeGuard(assertCurrent);
    };
    check();
    return observe(
      owner.networkId,
      owner.address,
      request.address,
      signal,
      check,
      async ({ target, holder, call }) => {
        // These are the only calls made by the shared SDK's type and metadata helpers.
        const runner = {
          async call(transaction: {
            to?: string;
            data?: string;
          }): Promise<string> {
            check();
            const data = transaction.data;
            const known =
              data === '0x06fdde03' ||
              data === '0x95d89b41' ||
              data === '0x313ce567' ||
              data ===
                `0x70a08231${holder
                  .slice(2)
                  .toLowerCase()
                  .padStart(64, '0')}` ||
              data ===
                `0x70a08231${target
                  .slice(2)
                  .toLowerCase()
                  .padStart(64, '0')}` ||
              data === `0x01ffc9a780ac58cd${'0'.repeat(56)}` ||
              data === `0x01ffc9a7d9b67a26${'0'.repeat(56)}`;
            if (
              !known ||
              !transaction.to ||
              getAddress(transaction.to) !== target
            )
              throw invalid();
            const result = await call(data!);
            check();
            if (result.kind !== 'result') throw result.error;
            return result.data;
          },
        };
        const standard = await getContractType(target, runner);
        check();
        if (standard?.type !== `ERC-${request.type.slice(3)}`) throw invalid();
        const metadata =
          request.type === 'ERC20'
            // The SDK declarations require a whole provider; these helpers use
            // only ContractRunner.call, confined by the selector gate above.
            ? await getTokenStandardMetadata(target, holder, runner as Parameters<typeof getTokenStandardMetadata>[2]).then(
                (value) => ({
                  name: value.tokenSymbol,
                  symbol: value.tokenSymbol,
                  decimals: value.decimals,
                })
              )
            : await getNftStandardMetadata(target, runner as Parameters<typeof getNftStandardMetadata>[1]).then((value) => ({
                name: value.name,
                symbol: value.symbol,
                decimals: 0,
              }));
        check();
        return observation(request, {
          kind: 'watch-asset',
          type: request.type,
          address: target,
          ...metadata,
          ...(request.type === 'ERC1155' ? { tokenId: request.tokenId } : {}),
        });
      }
    );
  };
}

/** A request-owned capability; it never borrows the global token preview or an ownership ticket. */
export async function prepareNativeWatchAsset(
  input: DappWatchAssetRequest,
  inputOwner: NativeWatchAssetOwner,
  signal: AbortSignal,
  assertRequestCurrent: () => void,
  ports: Readonly<{
    source: PublicCustodySource;
    runtime(): NativeTokenRuntime | undefined;
    observe: NativeWatchAssetObserver;
  }>
): Promise<NativePreparedDappControl> {
  const request = snapshotRequest(input);
  const owner = Object.freeze({
    ...inputOwner,
    address: getAddress(inputOwner.address),
  });
  const source = ports.source;
  const observe = ports.observe;
  const initial = source.getSnapshot();
  const catalogue = source.getCatalogue?.();
  const runtime = ports.runtime();
  if (initial.phase !== 'ready' || !initial.account || !catalogue || !runtime)
    throw changed();
  if (request.type !== 'ERC20' && !runtime.addCollectible) throw invalid();
  const registration = snapshotNativeNetwork(
    getNativeNetwork(owner.networkId, catalogue.networks)
  );
  const lifetime = new AbortController();
  let disposed = false,
    consumed = false;
  const dispose = () => {
    disposed = true;
    lifetime.abort();
    signal.removeEventListener('abort', dispose);
  };
  signal.addEventListener('abort', dispose, { once: true });
  const check = () => {
    if (disposed || signal.aborted) throw changed();
    assertSynchronousEvmFeeGuard(assertRequestCurrent);
    const current = source.getSnapshot(),
      latest = source.getCatalogue?.();
    const account = latest?.accounts.find(
      (entry) => entry.id === owner.accountId
    );
    if (
      ports.source !== source ||
      ports.observe !== observe ||
      ports.runtime() !== runtime ||
      current.phase !== 'ready' ||
      current.revision !== initial.revision ||
      !current.account ||
      current.account.network !== owner.networkId ||
      getAddress(current.account.address) !== owner.address ||
      !latest ||
      latest.revision !== catalogue.revision ||
      latest.active.accountId !== owner.accountId ||
      latest.active.networkId !== owner.networkId ||
      !account ||
      getAddress(account.address) !== owner.address ||
      snapshotNativeNetwork(getNativeNetwork(owner.networkId, latest.networks))
        .registrationHash !== registration.registrationHash
    )
      throw changed();
  };
  try {
    check();
    const inventory = await runtime.load(check);
    check();
    const details = observation(
      request,
      await observe(request, owner, lifetime.signal, check)
    );
    check();
    return Object.freeze({
      details,
      assertCurrent: check,
      dispose,
      async commit(assertCommitCurrent) {
        if (consumed) throw changed();
        const guard = () => {
          check();
          assertSynchronousEvmFeeGuard(assertCommitCurrent);
          check();
        };
        guard();
        consumed = true;
        const fresh = observation(
          request,
          await observe(request, owner, lifetime.signal, guard)
        );
        guard();
        if (JSON.stringify(fresh) !== JSON.stringify(details))
          throw new Error('Asset metadata changed after review');
        if (request.type === 'ERC20')
          await runtime.add(
            inventory.revision,
            parseErc20Metadata({
              contractAddress: details.address,
              name: details.name,
              symbol: details.symbol,
              decimals: details.decimals,
            }),
            guard
          );
        else {
          const collectible = snapshotSavedCollectible(
            request.type === 'ERC721'
              ? { contractAddress: details.address, tokenStandard: 'ERC-721' }
              : {
                  contractAddress: details.address,
                  tokenStandard: 'ERC-1155',
                  tokenId: details.tokenId,
                }
          );
          await runtime.addCollectible!(inventory.revision, collectible, guard);
        }
        guard();
        return Object.freeze({ result: true as const, assertCurrent: guard });
      },
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
