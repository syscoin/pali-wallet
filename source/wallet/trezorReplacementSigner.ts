import { KeyringAccountType } from '@sidhujag/sysweb3-keyring/cjs/types.js';
import { assertPsbtAccountScope } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt-account-scope.js';
import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import {
  getNetworkConfig,
  INetworkType,
} from '@sidhujag/sysweb3-network/cjs/networks.js';

import { assertPsbtWorkBudget } from '../utils/psbtWorkBudget.ts';

import type { UtxoSignedScope } from './utxoSignedBinding.ts';
import type { TrezorKeyring } from '@sidhujag/sysweb3-keyring/cjs/trezor/index.js';
import type { Psbt } from 'bitcoinjs-lib';

/** Keep the SDK's device session, conversion, and returned transaction checks.
 * The pinned converter omits amounts for owned inputs. The local replacement
 * builder has already authenticated their witness UTXOs against the prevouts.
 */
export async function signTrezorReplacementPsbt({
  psbt,
  scope,
  trezor,
  assertCurrent,
  signal,
}: Readonly<{
  assertCurrent(): void;
  psbt: Readonly<{ assets: string; psbt: string }>;
  scope: UtxoSignedScope;
  signal: AbortSignal;
  trezor: Pick<TrezorKeyring, 'convertToTrezorFormat' | 'signUtxoTransaction'>;
}>) {
  assertCurrent();
  const { account, network } = scope;
  if (signal.aborted || account.type !== 'Trezor')
    throw new Error('Trezor replacement signing context changed');
  assertPsbtWorkBudget(psbt);
  const unsigned: Psbt = PsbtUtils.fromPali(psbt, network);
  assertPsbtAccountScope(unsigned, {
    account,
    accountId: account.id,
    accountType: KeyringAccountType.Trezor,
    network: {
      ...network,
      kind: INetworkType.Syscoin,
      label: network.currency,
    },
  });
  const { networks } = getNetworkConfig(network.slip44, network.currency);
  const request = trezor.convertToTrezorFormat({
    psbt: unsigned,
    coin: network.currency.toLowerCase(),
    network: network.slip44 === 1 ? networks.testnet : networks.mainnet,
  });
  if (
    !Array.isArray(request.inputs) ||
    request.inputs.length !== unsigned.inputCount
  )
    throw new Error('Trezor replacement inputs changed');
  const inputs = unsigned.data.inputs.map(({ witnessUtxo }, index) => {
    const input = request.inputs[index];
    if (input?.script_type !== 'SPENDWITNESS' || !witnessUtxo)
      throw new Error('Invalid Trezor replacement input');
    const amount = witnessUtxo.value.toString();
    if (input.amount !== undefined && String(input.amount) !== amount)
      throw new Error('Trezor replacement amount changed');
    return { ...input, amount };
  });
  assertCurrent();
  const signed = await trezor.signUtxoTransaction(
    { ...request, inputs },
    unsigned,
    { assertCurrent, signal }
  );
  assertCurrent();
  return PsbtUtils.toPali(signed);
}
