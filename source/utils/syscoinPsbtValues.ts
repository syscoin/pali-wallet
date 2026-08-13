import { utils as syscoinUtils } from 'syscoinjs-lib';
import { bufferUtils as syscoinBufferUtils } from 'syscointx-js';

const ALLOCATION_BURN_TO_SYSCOIN_VERSION = 138;
const SYSCOIN_BURN_TO_ALLOCATION_VERSION = 139;
const ALLOCATION_MINT_VERSION = 140;
const ALLOCATION_BURN_TO_ETHEREUM_VERSION = 141;
const ALLOCATION_SEND_VERSION = 142;
const SYSX_ASSET_GUID = '123456';
const CORE_MAX_SCRIPT_SIZE = 10_000;
const MAX_CONCURRENT_PREVOUT_LOOKUPS = 8;
const CORE_WITNESS_COMMITMENT_HEADER = Buffer.from('aa21a9ed', 'hex');
const SYSCOIN_ASSET_VERSIONS = new Set([
  ALLOCATION_BURN_TO_SYSCOIN_VERSION,
  SYSCOIN_BURN_TO_ALLOCATION_VERSION,
  ALLOCATION_MINT_VERSION,
  ALLOCATION_BURN_TO_ETHEREUM_VERSION,
  ALLOCATION_SEND_VERSION,
]);

export interface ISyscoinPsbtInputAsset {
  assetGuid: string;
  inputIndex: number;
  previousOutputIndex: number;
  previousTxid: string;
  value: string;
}

interface IExactAssetAllocation {
  assetGuid: string;
  values: Array<{ n: number; value: string }>;
}

type RawTransactionFetcher = (txid: string) => Promise<unknown>;

const toBigIntValue = (value: unknown, field: string): bigint => {
  const normalized = String(value);
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Unable to verify ${field}`);
  }
  return BigInt(normalized);
};

const normalizeAssetAllocations = (
  allocations: any[] | null | undefined
): IExactAssetAllocation[] =>
  (allocations || []).map((allocation: any) => ({
    assetGuid: String(allocation.assetGuid),
    values: (allocation.values || []).map((value: any) => ({
      n: value.n,
      value: toBigIntValue(value.value, 'asset allocation').toString(),
    })),
  }));

const asPushedBytes = (chunk: unknown): Buffer | null =>
  chunk instanceof Uint8Array ? Buffer.from(chunk) : null;

/**
 * Mirror Syscoin Core's GetSyscoinData selection boundary. Core uses the
 * first unspendable output, then treats a >=36-byte aa21a9ed first push as a
 * witness commitment and consumes exactly one following push. Selecting a
 * payload merely because it parses would let a decoy disagree with chainstate.
 * Pali additionally requires a structurally complete script and fails closed
 * on malformed trailing bytes rather than treating a decode failure as EOF.
 */
const getCoreSyscoinPayload = (transaction: any): Buffer => {
  const dataOutput = (transaction?.outs || []).find((output: any) => {
    const script = output?.script;
    return (
      script instanceof Uint8Array &&
      (script.length > CORE_MAX_SCRIPT_SIZE ||
        script[0] === syscoinUtils.bitcoinjs.opcodes.OP_RETURN)
    );
  });
  const script = dataOutput?.script;
  if (!(script instanceof Uint8Array)) {
    throw new Error('Unable to verify Syscoin transaction data');
  }

  const chunks = syscoinUtils.bitcoinjs.script.decompile(script);
  if (!chunks || chunks[0] !== syscoinUtils.bitcoinjs.opcodes.OP_RETURN) {
    throw new Error('Unable to verify Syscoin transaction data');
  }

  const firstPush = asPushedBytes(chunks[1]);
  if (!firstPush) {
    throw new Error('Unable to verify Syscoin transaction data');
  }

  const hasWitnessCommitment =
    firstPush.length >= 36 &&
    firstPush
      .subarray(0, CORE_WITNESS_COMMITMENT_HEADER.length)
      .equals(CORE_WITNESS_COMMITMENT_HEADER);
  const payloadIndex = hasWitnessCommitment ? 2 : 1;
  const payload = asPushedBytes(chunks[payloadIndex]);
  if (!payload || chunks.length !== payloadIndex + 1) {
    throw new Error('Unable to verify Syscoin transaction data');
  }

  return payload;
};

const getExactAssetAllocations = (
  transaction: any
): IExactAssetAllocation[] => {
  if (!SYSCOIN_ASSET_VERSIONS.has(transaction?.version)) return [];

  try {
    const payload = getCoreSyscoinPayload(transaction);
    const decoded = syscoinBufferUtils.deserializeAssetAllocations(payload);
    const allocations = normalizeAssetAllocations(decoded);
    if (allocations.length === 0) {
      throw new Error('Empty Syscoin asset allocations');
    }

    for (const allocation of allocations) {
      if (
        !/^\d+$/.test(allocation.assetGuid) ||
        allocation.values.length === 0
      ) {
        throw new Error('Invalid Syscoin asset allocation');
      }

      for (const value of allocation.values) {
        if (
          !Number.isSafeInteger(value.n) ||
          value.n < 0 ||
          value.n >= transaction.outs.length
        ) {
          throw new Error('Invalid Syscoin asset output');
        }
      }
    }

    return allocations;
  } catch (_error) {
    throw new Error('Unable to verify Syscoin transaction data');
  }
};

const getRawTransactionHex = (response: any): string | null => {
  if (typeof response === 'string') return response;
  if (typeof response?.hex === 'string') return response.hex;
  if (typeof response?.result === 'string') return response.result;
  if (typeof response?.result?.hex === 'string') return response.result.hex;
  return null;
};

const getInputAssetMetadata = (input: any, inputIndex: number) => {
  const entries = (input?.unknownKeyVals || []).filter(
    (entry: any) => entry?.key?.toString() === 'assetInfo'
  );
  if (entries.length > 1) {
    throw new Error(`Conflicting PSBT input ${inputIndex} asset metadata`);
  }
  if (entries.length === 0) return null;

  try {
    return JSON.parse(entries[0].value.toString());
  } catch (_error) {
    throw new Error(`Invalid PSBT input ${inputIndex} asset metadata`);
  }
};

const sumAssets = (
  assets: Array<{ assetGuid: string; value: string }>
): Map<string, bigint> => {
  const totals = new Map<string, bigint>();
  for (const asset of assets) {
    totals.set(
      asset.assetGuid,
      (totals.get(asset.assetGuid) || BigInt(0)) + BigInt(asset.value)
    );
  }
  return totals;
};

const verifyAssetConservation = (
  transactionVersion: number,
  inputAssets: ISyscoinPsbtInputAsset[],
  outputAllocations: IExactAssetAllocation[]
) => {
  const versionsThatConsumeAssets = new Set([
    ALLOCATION_BURN_TO_SYSCOIN_VERSION,
    ALLOCATION_BURN_TO_ETHEREUM_VERSION,
    ALLOCATION_SEND_VERSION,
  ]);

  if (
    inputAssets.length > 0 &&
    !versionsThatConsumeAssets.has(transactionVersion)
  ) {
    throw new Error(
      `Asset-bearing PSBT input ${inputAssets[0].inputIndex} is not allowed in transaction version ${transactionVersion}`
    );
  }

  if (!versionsThatConsumeAssets.has(transactionVersion)) return;

  const inputTotals = sumAssets(inputAssets);
  const outputTotals = sumAssets(
    outputAllocations.flatMap((allocation) =>
      allocation.values.map(({ value }) => ({
        assetGuid: allocation.assetGuid,
        value,
      }))
    )
  );
  const assetGuids = new Set([...inputTotals.keys(), ...outputTotals.keys()]);

  for (const assetGuid of assetGuids) {
    if (
      (inputTotals.get(assetGuid) || BigInt(0)) !==
      (outputTotals.get(assetGuid) || BigInt(0))
    ) {
      throw new Error(
        `PSBT asset ${assetGuid} inputs do not match its serialized allocations`
      );
    }
  }
};

const verifyPreviousTransaction = (
  psbt: any,
  inputIndex: number,
  previousTransaction: any
) => {
  const txInput = psbt.txInputs[inputIndex];
  const input = psbt.data.inputs[inputIndex];
  if (!Buffer.from(txInput.hash).equals(previousTransaction.getHash())) {
    throw new Error(`PSBT input ${inputIndex} previous transaction mismatch`);
  }

  const previousOutput = previousTransaction.outs?.[txInput.index];
  if (!previousOutput) {
    throw new Error(`Unable to verify PSBT input ${inputIndex}`);
  }
  if (
    input.witnessUtxo &&
    (toBigIntValue(input.witnessUtxo.value, `PSBT input ${inputIndex}`) !==
      toBigIntValue(previousOutput.value, `PSBT input ${inputIndex}`) ||
      !Buffer.from(input.witnessUtxo.script).equals(previousOutput.script))
  ) {
    throw new Error(`Conflicting PSBT input ${inputIndex} UTXO data`);
  }
};

const resolvePreviousTransactions = async (
  psbt: any,
  fetchRawTransaction: RawTransactionFetcher
): Promise<any[]> => {
  const previousTransactions = new Array(psbt.txInputs.length);
  const remoteInputIndexesByTxid = new Map<string, number[]>();

  psbt.txInputs.forEach((txInput: any, inputIndex: number) => {
    const input = psbt.data.inputs[inputIndex];
    if (input.nonWitnessUtxo) {
      const previousTransaction = syscoinUtils.bitcoinjs.Transaction.fromBuffer(
        input.nonWitnessUtxo
      );
      verifyPreviousTransaction(psbt, inputIndex, previousTransaction);
      previousTransactions[inputIndex] = previousTransaction;
      return;
    }

    const previousTxid = Buffer.from(txInput.hash).reverse().toString('hex');
    const inputIndexes = remoteInputIndexesByTxid.get(previousTxid);
    if (inputIndexes) {
      inputIndexes.push(inputIndex);
    } else {
      remoteInputIndexesByTxid.set(previousTxid, [inputIndex]);
    }
  });

  const lookups = Array.from(remoteInputIndexesByTxid.entries());
  let nextLookupIndex = 0;
  let lookupFailed = false;
  const runLookupWorker = async () => {
    while (!lookupFailed) {
      const lookup = lookups[nextLookupIndex++];
      if (!lookup) return;

      const [previousTxid, inputIndexes] = lookup;
      try {
        const response = await fetchRawTransaction(previousTxid);
        const rawTransactionHex = getRawTransactionHex(response);
        if (
          !rawTransactionHex ||
          rawTransactionHex.length % 2 !== 0 ||
          !/^[0-9a-fA-F]+$/.test(rawTransactionHex)
        ) {
          throw new Error(
            `Unable to verify PSBT input ${inputIndexes[0]} prevout`
          );
        }
        const previousTransaction =
          syscoinUtils.bitcoinjs.Transaction.fromHex(rawTransactionHex);

        for (const inputIndex of inputIndexes) {
          verifyPreviousTransaction(psbt, inputIndex, previousTransaction);
          previousTransactions[inputIndex] = previousTransaction;
        }
      } catch (error) {
        lookupFailed = true;
        throw error;
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_PREVOUT_LOOKUPS, lookups.length) },
      runLookupWorker
    )
  );

  return previousTransactions;
};

const getVerifiedInputAssets = (
  psbt: any,
  previousTransactions: any[],
  transactionVersion: number,
  outputAllocations: IExactAssetAllocation[]
): ISyscoinPsbtInputAsset[] => {
  const inputAssets = previousTransactions.flatMap(
    (previousTransaction, inputIndex) => {
      const previousOutputIndex = psbt.txInputs[inputIndex].index;
      const previousTxid = previousTransaction.getId();
      const assets = getExactAssetAllocations(previousTransaction).flatMap(
        (allocation) =>
          allocation.values
            .filter(({ n }) => n === previousOutputIndex)
            .map(({ value }) => ({
              assetGuid: allocation.assetGuid,
              inputIndex,
              previousOutputIndex,
              previousTxid,
              value,
            }))
      );

      return assets;
    }
  );

  verifyAssetConservation(transactionVersion, inputAssets, outputAllocations);

  for (let inputIndex = 0; inputIndex < psbt.data.inputs.length; inputIndex++) {
    const metadata = getInputAssetMetadata(
      psbt.data.inputs[inputIndex],
      inputIndex
    );
    const actualAssets = inputAssets.filter(
      (asset) => asset.inputIndex === inputIndex
    );

    if (actualAssets.length === 0) {
      if (metadata) {
        throw new Error(`Conflicting PSBT input ${inputIndex} asset metadata`);
      }
      continue;
    }
    if (!metadata) {
      throw new Error(`PSBT input ${inputIndex} omits its asset metadata`);
    }
    if (
      actualAssets.length !== 1 ||
      String(metadata.assetGuid) !== actualAssets[0].assetGuid ||
      toBigIntValue(metadata.value, `PSBT input ${inputIndex} asset`) !==
        BigInt(actualAssets[0].value)
    ) {
      throw new Error(`Conflicting PSBT input ${inputIndex} asset metadata`);
    }
  }

  return inputAssets;
};

export const getSyscoinPsbtValueSummary = (
  psbt: any,
  previousTransactions?: any[]
): {
  assetAllocations: Array<{
    assetGuid: string;
    values: Array<{ n: number; value: string }>;
  }>;
  feeSatoshis: string;
  outputValuesSatoshis: string[];
} => {
  if (
    !psbt?.data?.inputs ||
    !Array.isArray(psbt.txInputs) ||
    !Array.isArray(psbt.txOutputs) ||
    psbt.data.inputs.length === 0 ||
    psbt.txOutputs.length === 0 ||
    psbt.data.inputs.length !== psbt.txInputs.length
  ) {
    throw new Error('Unable to verify PSBT inputs and outputs');
  }

  let totalInput = BigInt(0);
  for (let index = 0; index < psbt.data.inputs.length; index++) {
    const input = psbt.data.inputs[index];
    let inputValue: unknown;

    if (input.nonWitnessUtxo || previousTransactions?.[index]) {
      const previousTransaction =
        previousTransactions?.[index] ||
        syscoinUtils.bitcoinjs.Transaction.fromBuffer(input.nonWitnessUtxo);
      if (
        !Buffer.from(psbt.txInputs[index].hash).equals(
          previousTransaction.getHash()
        )
      ) {
        throw new Error(`PSBT input ${index} previous transaction mismatch`);
      }
      const previousOutput =
        previousTransaction.outs?.[psbt.txInputs[index].index];
      if (!previousOutput) {
        throw new Error(`Unable to verify PSBT input ${index}`);
      }

      if (
        input.witnessUtxo &&
        (toBigIntValue(input.witnessUtxo.value, `PSBT input ${index}`) !==
          toBigIntValue(previousOutput.value, `PSBT input ${index}`) ||
          !Buffer.from(input.witnessUtxo.script).equals(previousOutput.script))
      ) {
        throw new Error(`Conflicting PSBT input ${index} UTXO data`);
      }
      inputValue = previousOutput.value;
    } else if (input.witnessUtxo?.value !== undefined) {
      inputValue = input.witnessUtxo.value;
    }

    if (inputValue === undefined) {
      throw new Error(`Unable to verify PSBT input ${index}`);
    }
    totalInput += toBigIntValue(inputValue, `PSBT input ${index}`);
  }

  const outputValuesSatoshis = psbt.txOutputs.map(
    (output: any, index: number) =>
      toBigIntValue(output.value, `PSBT output ${index}`).toString()
  );
  const totalOutput = outputValuesSatoshis.reduce(
    (total: bigint, value: string) => total + BigInt(value),
    BigInt(0)
  );

  if (typeof psbt.extractTransaction !== 'function') {
    throw new Error('Unable to verify PSBT asset allocations');
  }
  const transaction = psbt.extractTransaction(true, true);
  const assetAllocations = getExactAssetAllocations(transaction);

  let effectiveInput = totalInput;
  if (transaction.version === ALLOCATION_BURN_TO_SYSCOIN_VERSION) {
    const mintedSys = toBigIntValue(
      transaction.outs?.[0]?.value,
      'SYSX to SYS mint output'
    );
    const burnOutputIndex = transaction.outs?.findIndex(
      (output: any) =>
        output?.script?.[0] === syscoinUtils.bitcoinjs.opcodes.OP_RETURN
    );
    const matchingBurns = assetAllocations.flatMap((allocation) =>
      allocation.assetGuid === SYSX_ASSET_GUID
        ? allocation.values.filter(
            ({ n, value }) =>
              Number.isInteger(n) &&
              n === burnOutputIndex &&
              burnOutputIndex > 0 &&
              BigInt(value) === mintedSys
          )
        : []
    );

    if (
      mintedSys <= BigInt(0) ||
      transaction.outs?.length !== outputValuesSatoshis.length ||
      mintedSys.toString() !== outputValuesSatoshis[0] ||
      matchingBurns.length !== 1
    ) {
      throw new Error(
        'SYSX burn amount does not match the native SYS mint output'
      );
    }

    effectiveInput += mintedSys;
  }

  if (effectiveInput < totalOutput) {
    throw new Error('PSBT outputs exceed its effective inputs');
  }

  return {
    assetAllocations,
    feeSatoshis: (effectiveInput - totalOutput).toString(),
    outputValuesSatoshis,
  };
};

export const getVerifiedSyscoinPsbtValueSummary = async (
  psbt: any,
  fetchRawTransaction: RawTransactionFetcher
): Promise<
  ReturnType<typeof getSyscoinPsbtValueSummary> & {
    inputAssets: ISyscoinPsbtInputAsset[];
  }
> => {
  const previousTransactions = await resolvePreviousTransactions(
    psbt,
    fetchRawTransaction
  );
  const summary = getSyscoinPsbtValueSummary(psbt, previousTransactions);
  const transaction = psbt.extractTransaction(true, true);
  const inputAssets = getVerifiedInputAssets(
    psbt,
    previousTransactions,
    transaction.version,
    summary.assetAllocations
  );

  return { ...summary, inputAssets };
};
