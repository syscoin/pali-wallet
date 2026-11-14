import { AbiCoder } from 'ethers/abi';
import { getAddress } from 'ethers/address';
import { isCallException, isHexString } from 'ethers/utils';

import { decodeAssetTransfer } from '../../shared/assetTransfer.ts';
import { parseErc20Decimals } from '../../shared/erc20.ts';
import {
  EvmAssetStateError,
  readEvmAssetBalance,
  type EvmAssetRead,
  type EvmTransferAsset,
} from '../../shared/evmAssetState.ts';
import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';
import { normalizeNftExecutionRevert } from '../../shared/nftReads.ts';

import {
  ERC7579_MODE_BATCH_DEFAULT,
  ERC7579_MODE_SINGLE_DEFAULT,
  type SmartAccountPackedUserOperation,
} from './account.ts';
import {
  getPaliEntryPointAddress,
  paliSmartAccountInterface,
} from './contracts.ts';
import { assertSmartAccountNativeSpendability } from './nativeSpendability.ts';

export async function assertSmartAccountSpendability(
  input: Parameters<typeof assertSmartAccountAssetSpendability>[0]
): Promise<void> {
  await assertSmartAccountNativeSpendability(input);
  await assertSmartAccountAssetSpendability(input);
}

const word = (value: unknown) =>
  typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const rejected = (message: string) =>
  Object.assign(new Error(message), { transactionNotBroadcast: true });

/** Check known asset calls independently of gas estimation, which may fall back. */
export async function assertSmartAccountAssetSpendability({
  provider,
  chainId,
  userOperation,
  assertCurrent,
}: {
  assertCurrent(): void;
  chainId: number;
  provider: any;
  userOperation: SmartAccountPackedUserOperation;
}): Promise<void> {
  const check = () => assertSynchronousEvmFeeGuard(assertCurrent);
  check();
  const operation = { ...userOperation },
    from = getAddress(operation.sender);
  const [mode, payload] = paliSmartAccountInterface.decodeFunctionData(
    'execute',
    operation.callData
  );
  if (
    paliSmartAccountInterface
      .encodeFunctionData('execute', [mode, payload])
      .toLowerCase() !== operation.callData.toLowerCase()
  )
    throw rejected('Invalid smart account execution');
  const calls: Array<{ data: string; to: string; value: string }> = [];
  if (mode === ERC7579_MODE_SINGLE_DEFAULT && payload.length >= 106) {
    calls.push({
      to: getAddress('0x' + payload.slice(2, 42)),
      value: BigInt('0x' + payload.slice(42, 106)).toString(),
      data: '0x' + payload.slice(106),
    });
  } else if (mode === ERC7579_MODE_BATCH_DEFAULT) {
    const abi = AbiCoder.defaultAbiCoder(),
      types = ['tuple(address target,uint256 value,bytes callData)[]'];
    const decoded = abi.decode(types, payload);
    if (
      !decoded[0].length ||
      decoded[0].length > 50 ||
      abi.encode(types, decoded).toLowerCase() !== payload.toLowerCase()
    )
      throw rejected('Invalid smart account execution');
    for (const call of decoded[0])
      calls.push({
        to: getAddress(call.target),
        value: call.value.toString(),
        data: call.callData,
      });
  } else return;
  const candidates = calls
    .map((call) => ({ call, decoded: decodeAssetTransfer(call.data, call.to) }))
    .filter(
      (item) =>
        item.decoded && (!item.decoded.from || item.decoded.from === from)
    );
  if (!candidates.length) return;
  await provider.verifyConfiguredChainId(true);
  check();
  const read: EvmAssetRead = async (method, params) => {
    check();
    const value = await provider.send(method, [...params]);
    check();
    return value;
  };
  const probe = async (to: string, data: string) => {
    try {
      return await read('eth_call', [{ to, data }, 'pending']);
    } catch (error) {
      check();
      if (
        normalizeNftExecutionRevert(error, { to, data }) ||
        (isCallException(error) &&
          error.action === 'call' &&
          typeof error.data === 'string' &&
          error.data.length <= 8194 &&
          isHexString(error.data, true))
      )
        return null;
      throw error;
    }
  };
  const known: Array<{
    assets: EvmTransferAsset[];
    balance?: unknown;
    call: (typeof calls)[number];
  }> = [];
  for (const { call, decoded } of candidates) {
    if (!decoded) continue;
    const possibleNft =
      decoded.standard === 'ERC-721' ||
      decoded.standard === 'ERC-1155' ||
      decoded.method === 'transferFrom';
    let nft: 'ERC-721' | 'ERC-1155' | undefined;
    if (possibleNft) {
      const type = decoded.standard === 'ERC-1155' ? 'ERC-1155' : 'ERC-721';
      const id = type === 'ERC-1155' ? 'd9b67a26' : '80ac58cd';
      const result = await probe(call.to, '0x01ffc9a7' + id.padEnd(64, '0'));
      if (word(result) && BigInt(result as string) === BigInt(1)) nft = type;
    }
    if (nft) {
      const transfer = decodeAssetTransfer(call.data, call.to, {
        standard: nft,
      });
      if (!transfer) continue;
      known.push({
        call,
        assets: transfer.items
          .filter((item) => item.units !== '0')
          .map((item) => ({
            standard:
              nft === 'ERC-721' ? ('ERC721' as const) : ('ERC1155' as const),
            contractAddress: call.to,
            tokenId: item.tokenId!,
            amountUnits: item.units,
          })),
      });
    } else if (
      decoded.standard === 'Unknown' &&
      decoded.method === 'transfer'
    ) {
      const [balance, decimals] = await Promise.all([
        probe(
          call.to,
          '0x70a08231' + from.slice(2).toLowerCase().padStart(64, '0')
        ),
        probe(call.to, '0x313ce567'),
      ]);
      if (!word(decimals)) continue;
      try {
        parseErc20Decimals(BigInt(decimals as string));
      } catch {
        continue;
      }
      if (word(balance) && decoded.items[0]?.units !== '0')
        known.push({
          call,
          balance,
          assets: [
            {
              standard: 'ERC20',
              contractAddress: call.to,
              amountUnits: decoded.items[0]!.units,
            },
          ],
        });
    }
  }
  if (!known.length) return;
  if (calls.length > 1) {
    // Unknown contracts may depend on tx.origin, which an EntryPoint eth_call
    // cannot reproduce. Keep their existing submission path unchanged.
    if (known.length !== calls.length) return;
    // Execute a known-asset batch once, never sum balances across ordered calls.
    const code = await read('eth_getCode', [from, 'pending']);
    if (code === '0x') return; // Counterfactual execution remains with handleOps.
    await read('eth_call', [
      {
        from: getPaliEntryPointAddress(chainId),
        to: from,
        data: operation.callData,
      },
      'pending',
    ]);
  } else {
    const selected = known[0]!;
    const balanceRead: EvmAssetRead = (method, params) =>
      method === 'eth_call' &&
      selected.balance !== undefined &&
      (params[0] as any)?.data?.startsWith('0x70a08231')
        ? Promise.resolve(selected.balance)
        : read(method, params);
    // Multi-ID ERC1155 uses its exact single contract call below. Reading each
    // ID separately would multiply RPC load and mishandle repeated IDs.
    for (const asset of selected.assets.length === 1 ? selected.assets : []) {
      const balance = await readEvmAssetBalance(
        balanceRead,
        from,
        asset,
        'pending'
      );
      check();
      if (balance < BigInt(asset.amountUnits))
        throw Object.assign(new EvmAssetStateError('INSUFFICIENT_ASSET'), {
          message: 'Insufficient token or collectible balance',
          transactionNotBroadcast: true,
        });
    }
    const result = await read('eth_call', [
      {
        from,
        to: selected.call.to,
        data: selected.call.data,
        value: '0x' + BigInt(selected.call.value).toString(16),
      },
      'pending',
    ]);
    if (
      selected.assets[0]?.standard === 'ERC20' &&
      result !== '0x' &&
      (!word(result) || BigInt(result as string) !== BigInt(1))
    )
      throw rejected('Asset transfer would fail');
  }
  check();
  await provider.verifyConfiguredChainId(true);
  check();
}
