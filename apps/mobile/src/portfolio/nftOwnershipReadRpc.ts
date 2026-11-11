import {
  discoverNftTokens,
  MAX_ENUMERATED_NFTS,
  normalizeNftExecutionRevert,
  verifyERC1155OwnershipHelper,
  verifyERC721OwnershipHelper,
} from '../../../../source/shared/nftReads.ts';
import type { NftReadRunner } from '../../../../source/shared/nftReads.ts';
import { parseErc20Units } from '../../../../source/shared/erc20.ts';
import { normalizeNftTokenId } from '../../../../source/utils/nftTokenId.ts';
import {
  createSelectedNftReadOperation,
  createSelectedNftEnumerationReadOperation,
  Erc20ReadError,
  type ScopedCallOutcome,
} from './erc20ReadRpc.ts';

type Selection = Readonly<{
  networkId: string;
  owner: string;
  contractAddress: string;
  tokenId: string;
  tokenStandard: 'ERC-721' | 'ERC-1155';
}>;
export type NftEnumerationResult = Readonly<{
  tokenIds: readonly string[];
  totalOwned?: string;
  hasMore: boolean;
  method: 'enumeration' | 'manual';
}>;

function selectedRunner(
  target: string,
  call: (data: string) => Promise<ScopedCallOutcome>,
  maximumCalls: number
): NftReadRunner {
  let calls = 0;
  return {
    async call({ to, data }) {
      if (to !== target || typeof data !== 'string' || ++calls > maximumCalls)
        throw new Erc20ReadError('INVALID_RESPONSE');
      const outcome = await call(data);
      if (outcome.kind === 'result') return outcome.data;
      throw (
        normalizeNftExecutionRevert(outcome.error, { to: target, data }) ??
        new Erc20ReadError('INVALID_RESPONSE')
      );
    },
  };
}

/** The caller owns the exact contract, sampled block and request lifetime. */
export async function readSelectedNftUnits(
  holder: string,
  target: string,
  tokenId: string,
  tokenStandard: Selection['tokenStandard'],
  call: (data: string) => Promise<ScopedCallOutcome>
): Promise<string> {
  const verify =
    tokenStandard === 'ERC-721'
      ? verifyERC721OwnershipHelper
      : verifyERC1155OwnershipHelper;
  // One independent probe plus one selected read. A failed native batch
  // cannot authorize individual fallback reads or yield a known quantity.
  const runner = selectedRunner(target, call, 2);
  const [holding] = await verify(target, holder, [tokenId], runner);
  if (!holding?.verified) throw new Erc20ReadError('UNAVAILABLE');
  const units =
    tokenStandard === 'ERC-721' ? String(holding.balance) : holding.rawBalance;
  if (units === undefined) throw new Erc20ReadError('INVALID_RESPONSE');
  return units;
}

/** The owning selection guard must revoke on lock and on every selection generation change. */
export function createNftOwnershipReader(
  options: Parameters<typeof createSelectedNftReadOperation>[0]
) {
  const observe = createSelectedNftReadOperation(options);
  return async (
    selection: Selection,
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<Readonly<{ tokenId: string; units: string }>> => {
    const { networkId, owner, contractAddress, tokenStandard } = selection;
    let tokenId: string;
    try {
      tokenId = normalizeNftTokenId(selection.tokenId);
    } catch {
      throw new Erc20ReadError('INVALID_INPUT');
    }
    if (tokenStandard !== 'ERC-721' && tokenStandard !== 'ERC-1155')
      throw new Erc20ReadError('INVALID_INPUT');
    return observe(
      networkId,
      owner,
      contractAddress,
      signal,
      assertCurrent,
      async ({ holder, target, call }) =>
        Object.freeze({
          tokenId,
          units: await readSelectedNftUnits(holder, target, tokenId, tokenStandard, call),
        })
    );
  };
}

/** Enumeration supplies candidates only; selected IDs still require ownership checks. */
export function createNftEnumerationReader(
  options: Parameters<typeof createSelectedNftEnumerationReadOperation>[0]
) {
  const observe = createSelectedNftEnumerationReadOperation(options);
  return async (
    selection: Omit<Selection, 'tokenId' | 'tokenStandard'> & { tokenStandard: 'ERC-721' },
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<NftEnumerationResult> => {
    const { networkId, owner, contractAddress, tokenStandard } = selection;
    if (tokenStandard !== 'ERC-721') throw new Erc20ReadError('INVALID_INPUT');
    return observe(networkId, owner, contractAddress, signal, assertCurrent,
      async ({ holder, target, call }) => {
        const discovery = await discoverNftTokens(target, holder, tokenStandard,
          selectedRunner(target, call, 2 + MAX_ENUMERATED_NFTS));
        if (discovery.method !== 'enumeration' && discovery.method !== 'manual' ||
            (discovery.tokens?.length ?? 0) > MAX_ENUMERATED_NFTS)
          throw new Erc20ReadError('INVALID_RESPONSE');
        return Object.freeze({
          tokenIds: Object.freeze((discovery.tokens ?? []).map(token => normalizeNftTokenId(token.tokenId))),
          ...(discovery.totalOwned === undefined ? {} : { totalOwned: parseErc20Units(discovery.totalOwned) }),
          hasMore: discovery.hasMore === true,
          method: discovery.method,
        });
      });
  };
}
