import { utils as syscoinUtils } from 'syscoinjs-lib';

const ALLOCATION_BURN_TO_SYSCOIN_VERSION = 138;
const SYSX_ASSET_GUID = '123456';

const toBigIntValue = (value: unknown, field: string): bigint => {
  const normalized = String(value);
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Unable to verify ${field}`);
  }
  return BigInt(normalized);
};

export const getSyscoinPsbtValueSummary = (
  psbt: any
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

    if (input.nonWitnessUtxo) {
      const previousTransaction = syscoinUtils.bitcoinjs.Transaction.fromBuffer(
        input.nonWitnessUtxo
      );
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
  const assetAllocations = (
    syscoinUtils.getAllocationsFromTx(transaction) || []
  ).map((allocation: any) => ({
    assetGuid: String(allocation.assetGuid),
    values: (allocation.values || []).map((value: any) => ({
      n: value.n,
      value: toBigIntValue(value.value, 'asset allocation').toString(),
    })),
  }));

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
