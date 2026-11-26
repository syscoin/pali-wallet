import { readPublicSyscoinFee } from '@sidhujag/sysweb3-keyring/cjs/transactions/syscoin-core.js';
import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import { findUtxoCoinByRegistration } from '@sidhujag/sysweb3-network/cjs/coin-utils.js';
import { getNetworkConfig } from '@sidhujag/sysweb3-network/cjs/networks.js';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { coinSelect } from 'syscointx-js';

import { assertUtxoSoftwareSpend } from '../shared/utxoSoftwareCustody.ts';
import { inspectUtxoRbf } from '../shared/utxoTransactionOptions.ts';
import {
  assertPsbtWorkBudget,
  PSBT_WORK_LIMITS,
} from '../utils/psbtWorkBudget.ts';
import { findSentryWalletPath } from '../utils/sentry/walletAuthority.ts';
import {
  getExactAssetAllocations,
  resolvePreviousTransactions,
} from '../utils/syscoinPsbtValues.ts';
import { utxoInputOutpoints } from '../utils/utxoAcknowledgedInputs.ts';

import type { createOwnedUtxoBlockbookRead } from './utxoBlockbookReads.ts';
import {
  createUtxoTransactionBinding,
  utxoSubmissionUrl,
  type UtxoSignedBindingRecord,
  type UtxoSignedScope,
} from './utxoSignedBinding.ts';
import type {
  UtxoDurableSubmission,
  UtxoRetainedSubmission,
} from './utxoSignedRecords.ts';
import type { Psbt, Transaction } from 'bitcoinjs-lib';

export type UtxoReplacementKind = 'speed-up' | 'cancel';
type Predecessor = UtxoDurableSubmission | UtxoRetainedSubmission;

type ReplacementRequest = Readonly<{
  assertCurrent: () => void;
  feeRateSatoshisPerVbyte?: string;
  feeSatoshis?: string;
  fetchPreviousTransaction: (txid: string) => Promise<unknown>;
  getPathHints?: (
    address: string
  ) => readonly string[] | Promise<readonly string[]>;
  isOwnedAddress: (address: string) => boolean | Promise<boolean>;
  kind: UtxoReplacementKind;
  ownedAddress?: string;
  predecessor: Predecessor;
  scope: UtxoSignedScope;
}>;

type PsbtData = Readonly<{ assets: string; psbt: string }>;

const { bitcoinjs } = syscoinUtils;
const isP2wpkh = (script: Uint8Array) =>
  script.length === 22 && script[0] === 0 && script[1] === 20;
const validFee = (value: unknown): value is string =>
  typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value);
const max = (a: bigint, b: bigint) => (a >= b ? a : b);
const unsupported = () =>
  new Error('This transaction is unsupported for wallet replacement.');
const maxFeeRate = BigInt(5000);

export async function readUtxoReplacementFee(
  url: string,
  read: ReturnType<typeof createOwnedUtxoBlockbookRead>
): Promise<number | undefined> {
  const noEstimate = new Error('Blockbook has no replacement fee estimate');
  try {
    return await readPublicSyscoinFee(url, {
      assertCurrent: read.assertCurrent,
      signal: read.signal,
      async fetch(input, init) {
        const response = await read.fetch(input, init);
        if (response.ok) {
          const body = await response.clone().json();
          read.assertCurrent();
          // Blockbook can return a successful zero quote when no estimate exists.
          if (
            body &&
            typeof body === 'object' &&
            !Array.isArray(body) &&
            !Object.hasOwn(body, 'error') &&
            typeof body.result === 'string' &&
            /^0(?:\.0+)?$/.test(body.result)
          )
            throw noEstimate;
        }
        return response;
      },
    });
  } catch (error) {
    if (error !== noEstimate) throw error;
    read.assertCurrent();
    return undefined;
  }
}

function minimumFee(previousFee: bigint, previousSize: bigint, size: bigint) {
  // One sat/vB for incremental relay and a strictly higher fee rate.
  return max(
    previousFee + size,
    (previousFee * size) / previousSize + BigInt(1)
  );
}

function replacementCoin(owner: Predecessor['owner']) {
  if (
    !['HDAccount', 'Imported', 'Ledger', 'Trezor'].includes(
      owner.account.type
    ) ||
    !(
      (owner.chainId === 0 && owner.slip44 === 0) ||
      (owner.chainId === 57 && owner.slip44 === 57) ||
      (owner.chainId === 5700 && owner.slip44 === 1)
    )
  )
    return undefined;
  const coin = findUtxoCoinByRegistration(owner);
  return coin?.hashGenesisBlock === owner.genesisHash ? coin : undefined;
}

function readPredecessor(predecessor: Predecessor): Transaction {
  if (
    predecessor.operation !== 'wallet' ||
    !replacementCoin(predecessor.owner) ||
    !Number.isSafeInteger(predecessor.virtualSize) ||
    predecessor.virtualSize <= 0 ||
    !validFee(predecessor.feeSatoshis)
  )
    throw unsupported();
  const raw =
    'unsignedTransaction' in predecessor
      ? predecessor.unsignedTransaction
      : predecessor.rawTransaction;
  if (
    typeof raw !== 'string' ||
    !/^[0-9a-f]+$/.test(raw) ||
    raw.length > 2 * PSBT_WORK_LIMITS.bytes ||
    raw.length % 2
  )
    throw unsupported();
  const original: Transaction = bitcoinjs.Transaction.fromHex(raw);
  const outpoints = utxoInputOutpoints(original.ins);
  if (
    original.version !== 2 ||
    original.getId() !== predecessor.txid ||
    original.toHex() !== raw ||
    ('unsignedTransaction' in predecessor && original.hasWitnesses()) ||
    ('rawTransaction' in predecessor &&
      original.virtualSize() !== predecessor.virtualSize) ||
    original.ins.length > PSBT_WORK_LIMITS.inputs ||
    original.ins.some(({ script }) => script.length !== 0) ||
    !original.outs.length ||
    original.outs.length > 2 ||
    original.outs.some(
      ({ script, value }) =>
        value <= BigInt(0) ||
        !script.length ||
        script[0] === bitcoinjs.opcodes.OP_RETURN
    ) ||
    !inspectUtxoRbf(original.ins) ||
    outpoints.length !== predecessor.outpoints.length ||
    outpoints.some((point, index) => point !== predecessor.outpoints[index])
  )
    throw unsupported();
  return original;
}

/** Offer actions only for supported retained shapes. Preparation verifies spendability. */
export function availableUtxoReplacementKinds(
  predecessor: Predecessor
): readonly UtxoReplacementKind[] {
  try {
    const transaction = readPredecessor(predecessor);
    assertUtxoSoftwareSpend(
      predecessor.owner,
      transaction.outs.map(({ script }) => script)
    );
    return transaction.outs.length === 2 &&
      isP2wpkh(transaction.outs[1]!.script)
      ? ['speed-up', 'cancel']
      : ['cancel'];
  } catch {
    return [];
  }
}

/** Read raw prevouts and bounded, untrusted derivation hints through the owned connection. */
export function utxoReplacementReads(
  scope: UtxoSignedScope,
  read: ReturnType<typeof createOwnedUtxoBlockbookRead>
) {
  const { url } = scope.network;
  const { address, xpub } = scope.account;
  let hints: Promise<Map<string, string[]>> | undefined;
  return {
    async getPathHints(target: string): Promise<readonly string[]> {
      read.assertCurrent();
      if (address === xpub) return [];
      hints ??= Promise.resolve(
        syscoinUtils.fetchBackendAccount(
          url,
          xpub,
          'tokens=used&details=tokens',
          true,
          undefined,
          read
        )
      ).then((response) => {
        read.assertCurrent();
        const byAddress = new Map<string, string[]>();
        if (!Array.isArray(response?.tokens) || response.tokens.length > 10_000)
          return byAddress;
        for (const token of response.tokens) {
          if (
            typeof token?.name !== 'string' ||
            token.name.length > 256 ||
            typeof token.path !== 'string' ||
            token.path.length > 128
          )
            continue;
          const paths = byAddress.get(token.name) ?? [];
          if (paths.length >= 32) continue;
          paths.push(token.path);
          byAddress.set(token.name, paths);
        }
        return byAddress;
      });
      const paths = (await hints).get(target);
      read.assertCurrent();
      return paths ?? [];
    },
    async fetchPreviousTransaction(txid: string): Promise<unknown> {
      read.assertCurrent();
      try {
        return await syscoinUtils.fetchBackendRawTx(url, txid, read);
      } finally {
        read.assertCurrent();
      }
    },
  };
}

/** Build the exact reviewed bytes for a wallet-owned, ordinary BIP84 replacement. */
export async function prepareUtxoReplacement({
  scope,
  predecessor,
  kind,
  feeSatoshis,
  feeRateSatoshisPerVbyte,
  ownedAddress,
  isOwnedAddress,
  getPathHints,
  fetchPreviousTransaction,
  assertCurrent,
}: ReplacementRequest) {
  const check = () => {
    const result: unknown = assertCurrent();
    if (result === undefined) return;
    void Promise.resolve(result).catch(() => undefined);
    throw new Error('UTXO replacement requires a synchronous owner.');
  };
  check();
  // Detach the values used after awaits from the caller's session state.
  scope = Object.freeze({
    ...scope,
    account: Object.freeze({ ...scope.account }),
    network: Object.freeze({ ...scope.network }),
  });
  const { account, network } = scope;
  const ledger = account.type === 'Ledger';
  const hardware = ledger || account.type === 'Trezor';
  const {
    owner,
    url,
    virtualSize,
    feeSatoshis: previousFeeSatoshis,
  } = predecessor;
  const issuedPaths = predecessor.issuedPaths?.map(({ path }) => path) ?? [];
  if (
    (kind !== 'speed-up' && kind !== 'cancel') ||
    !/^0x[0-9a-f]{64}$/.test(scope.profileId) ||
    network.kind !== 'syscoin' ||
    owner.chainId !== network.chainId ||
    owner.slip44 !== network.slip44 ||
    owner.genesisHash !== network.genesisHash ||
    owner.account.id !== account.id ||
    owner.account.type !== account.type ||
    owner.account.xpub !== account.xpub ||
    url !== utxoSubmissionUrl(network.url)
  )
    throw unsupported();
  if (
    (feeSatoshis !== undefined && !validFee(feeSatoshis)) ||
    (feeRateSatoshisPerVbyte !== undefined &&
      !validFee(feeRateSatoshisPerVbyte)) ||
    (feeSatoshis !== undefined && feeRateSatoshisPerVbyte !== undefined)
  )
    throw new Error('Invalid UTXO replacement fee.');

  const original = readPredecessor(predecessor);

  const { networks } = getNetworkConfig(network.slip44, network.currency);
  const addressNetwork =
    network.slip44 === 1 ? networks.testnet : networks.mainnet;
  const addressFromScript = (script: Uint8Array): string =>
    bitcoinjs.address.fromOutputScript(script, addressNetwork);
  const wallet = {
    account,
    accountId: account.id,
    imported: account.type === 'Imported',
    network: addressNetwork,
    slip44: network.slip44,
  };
  const pathByAddress = new Map<string, string | null | undefined>();
  const pathFor = async (address: string) => {
    if (pathByAddress.has(address)) return pathByAddress.get(address);
    let path = findSentryWalletPath(address, issuedPaths, wallet);
    if (path === undefined && getPathHints) {
      const hints = await getPathHints(address);
      check();
      if (hints.length)
        path = findSentryWalletPath(address, hints.slice(0, 32), wallet);
    }
    pathByAddress.set(address, path);
    return path;
  };
  const fullPath = (relative: string) =>
    `m/84'/${network.slip44}'/${account.id}'/${relative}`;
  const ownsOutput = async (address: string) => {
    const localPath = await pathFor(address);
    check();
    if (localPath !== undefined) return true;
    if (hardware) return false;
    const owned = await isOwnedAddress(address);
    check();
    return owned === true;
  };

  assertUtxoSoftwareSpend(
    network,
    original.outs.map(({ script }) => script)
  );
  const originalAddresses = original.outs.map(({ script }) =>
    addressFromScript(script)
  );
  const originalChange = original.outs[1];
  let targetAddress: string | undefined;
  if (kind === 'speed-up') {
    if (!originalChange || !(await ownsOutput(originalAddresses[1]!)))
      throw new Error(
        'No verified change is available to fund the higher fee.'
      );
    targetAddress = originalAddresses[1]!;
  } else {
    targetAddress = ownedAddress ?? originalAddresses[1] ?? account.address;
    if (!(await ownsOutput(targetAddress)))
      throw new Error(
        'The cancellation destination could not be verified as wallet-owned.'
      );
  }
  check();
  const targetScript = bitcoinjs.address.toOutputScript(
    targetAddress,
    addressNetwork
  );
  if (!isP2wpkh(targetScript)) throw unsupported();
  const targetDust = BigInt(
    coinSelect.utils.dustThreshold({ scriptPubKey: targetScript }).toString()
  );

  const psbt: Psbt = new bitcoinjs.Psbt({ network: addressNetwork });
  psbt.setVersion(original.version);
  psbt.setLocktime(original.locktime);
  original.ins.forEach(({ hash, index, sequence }) =>
    psbt.addInput({ hash, index, sequence })
  );
  const previousTransactions = await resolvePreviousTransactions(
    psbt,
    async (hash) => {
      check();
      try {
        return await fetchPreviousTransaction(hash);
      } finally {
        check();
      }
    },
    PSBT_WORK_LIMITS.bytes
  );
  check();
  const funding = original.ins.map(({ index }, i) => {
    const previous = previousTransactions[i]!;
    const output = previous.outs[index]!;
    if (
      !isP2wpkh(output.script) ||
      output.value <= BigInt(0) ||
      (network.chainId !== 0 &&
        getExactAssetAllocations(previous).some(({ values }) =>
          values.some(({ n }) => n === index)
        ))
    )
      throw unsupported();
    return output;
  });
  const inputsValue = funding.reduce(
    (value, output) => value + output.value,
    BigInt(0)
  );
  const previousFee = BigInt(previousFeeSatoshis);
  if (
    inputsValue -
      original.outs.reduce(
        (value, output) => value + output.value,
        BigInt(0)
      ) !==
    previousFee
  )
    throw new Error(
      'The retained fee differs from the verified previous outputs.'
    );

  const recipient = kind === 'speed-up' ? original.outs[0]! : undefined;
  if (recipient) psbt.addOutput(recipient);
  const available = inputsValue - (recipient?.value ?? BigInt(0));
  const previousSize = BigInt(virtualSize);
  const rate = BigInt(feeRateSatoshisPerVbyte ?? '0');
  const estimate = (withChange: boolean) => {
    const transaction: Transaction = bitcoinjs.Transaction.fromBuffer(
      psbt.data.globalMap.unsignedTx.toBuffer()
    );
    if (withChange) transaction.addOutput(targetScript, BigInt(0));
    // DER signature plus SIGHASH byte, compressed public key, and actual array framing.
    for (let i = 0; i < transaction.ins.length; i++)
      transaction.setWitness(i, [Buffer.alloc(73), Buffer.alloc(33)]);
    return BigInt(transaction.virtualSize());
  };
  // Dropping change is allowed only when the user explicitly approves its exact
  // value as the fee. The default never absorbs a dust remainder into the fee.
  const includeChange =
    kind === 'cancel' ||
    feeSatoshis === undefined ||
    BigInt(feeSatoshis) !== available;
  const estimateSize = estimate(includeChange);
  const minimum = minimumFee(previousFee, previousSize, estimateSize);
  const fee =
    feeSatoshis === undefined
      ? max(minimum, rate * estimateSize)
      : BigInt(feeSatoshis);
  const remaining = available - fee;
  if (fee < minimum)
    throw new Error(
      'The replacement fee does not meet the minimum relay fee and fee rate increase.'
    );
  if (fee >= maxFeeRate * estimateSize)
    throw new Error('The replacement fee exceeds the wallet safety limit.');
  if (includeChange) {
    if (remaining < targetDust)
      throw new Error(
        'The replacement fee leaves insufficient funds for a non-dust output.'
      );
    psbt.addOutput({ script: targetScript, value: remaining });
    if (hardware) {
      const changePath = await pathFor(targetAddress);
      check();
      if (typeof changePath !== 'string') throw unsupported();
      psbt.addUnknownKeyValToOutput(psbt.txOutputs.length - 1, {
        key: Buffer.from('path'),
        value: Buffer.from(fullPath(changePath)),
      });
    }
  }

  let ledgerPrevoutBytes = 0;
  for (const [index, output] of funding.entries()) {
    const address = addressFromScript(output.script);
    const path = await pathFor(address);
    check();
    if (path === undefined)
      throw new Error(
        'The funding address could not be verified as wallet-owned.'
      );
    const previous = previousTransactions[index]!;
    if (ledger) {
      ledgerPrevoutBytes += previous.byteLength();
      if (ledgerPrevoutBytes > PSBT_WORK_LIMITS.bytes)
        throw new Error(
          'The verified previous transactions exceed the wallet PSBT size limit.'
        );
    }
    psbt.updateInput(index, {
      witnessUtxo: output,
      ...(ledger ? { nonWitnessUtxo: previous.toBuffer() } : {}),
    });
    psbt.addUnknownKeyValToInput(index, {
      key: Buffer.from('address'),
      value: Buffer.from(address),
    });
    if (typeof path === 'string') {
      const signingPath = wallet.imported ? path : fullPath(path);
      psbt.addUnknownKeyValToInput(index, {
        key: Buffer.from('path'),
        value: Buffer.from(signingPath),
      });
    }
  }
  const binding = createUtxoTransactionBinding(psbt, fee.toString(), check);
  const outputs = psbt.txOutputs.map(({ script, value }) =>
    Object.freeze({
      address: addressFromScript(script),
      amountSatoshis: value.toString(),
    })
  );
  const review = Object.freeze({
    feeSatoshis: fee.toString(),
    minimumFeeSatoshis: minimum.toString(),
    previousFeeSatoshis,
    outpoints: binding.outpoints,
    outputs: Object.freeze(outputs),
    recipient: outputs[0]!,
  });
  const quote: PsbtData = Object.freeze(PsbtUtils.toPali(psbt));
  assertPsbtWorkBudget(quote);
  check();
  return Object.freeze({
    psbt: quote,
    review,
    bindSigned(signed: PsbtData) {
      check();
      assertPsbtWorkBudget(signed);
      const transaction = binding.bindSigned(
        PsbtUtils.fromPali(signed, network)
      );
      const finalized = bitcoinjs.Transaction.fromHex(
        transaction.rawTransaction
      );
      const signedSize = BigInt(transaction.virtualSize);
      if (
        signedSize > estimateSize ||
        fee >= maxFeeRate * signedSize ||
        fee < minimumFee(previousFee, previousSize, signedSize) ||
        finalized.ins.some(
          ({ script, witness }: Transaction['ins'][number], index: number) => {
            const [signature, publicKey] = witness;
            if (
              script.length !== 0 ||
              witness.length !== 2 ||
              !signature ||
              signature.length > 73 ||
              publicKey?.length !== 33
            )
              return true;
            const hash = bitcoinjs.crypto.hash160(publicKey);
            const output = funding[index]!;
            if (
              !Buffer.from(hash).equals(Buffer.from(output.script.subarray(2)))
            )
              return true;
            const { hashType, signature: decoded } =
              bitcoinjs.script.signature.decode(signature);
            if (hashType !== bitcoinjs.Transaction.SIGHASH_ALL) return true;
            const scriptCode = bitcoinjs.payments.p2pkh({ hash }).output;
            const sighash = finalized.hashForWitnessV0(
              index,
              scriptCode,
              output.value,
              hashType
            );
            return !bitcoinjs.ECPair.fromPublicKey(publicKey).verify(
              sighash,
              decoded
            );
          }
        )
      )
        throw unsupported();
      const record: UtxoSignedBindingRecord = Object.freeze({
        scope,
        review,
        rawTransaction: transaction.rawTransaction,
        txid: transaction.txid,
        virtualSize: transaction.virtualSize,
        url,
      });
      check();
      return Object.freeze({ record });
    },
  });
}
