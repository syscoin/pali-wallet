import {
  normalizeNftExecutionRevert,
  verifyERC1155OwnershipHelper,
  verifyERC721OwnershipHelper,
} from '../../../../source/scripts/Background/controllers/assets/nft-utils.ts';
import type { NftReadRunner } from '../../../../source/scripts/Background/controllers/assets/nft-utils.ts';
import { normalizeNftTokenId } from '../../../../source/utils/nftTokenId.ts';
import {
  createSelectedNftReadOperation,
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
  let calls = 0;
  const runner: NftReadRunner = {
    async call({ to, data }) {
      // One independent probe plus one selected read. A failed native batch
      // cannot authorize individual fallback reads or yield a known quantity.
      if (to !== target || typeof data !== 'string' || ++calls > 2)
        throw new Erc20ReadError('INVALID_RESPONSE');
      const outcome = await call(data);
      if (outcome.kind === 'result') return outcome.data;
      throw (
        normalizeNftExecutionRevert(outcome.error, { to: target, data }) ??
        new Erc20ReadError('INVALID_RESPONSE')
      );
    },
  };
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
