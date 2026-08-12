import { utils as syscoinUtils } from 'syscoinjs-lib';

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

  if (totalInput < totalOutput) {
    throw new Error('PSBT outputs exceed its inputs');
  }

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

  return {
    assetAllocations,
    feeSatoshis: (totalInput - totalOutput).toString(),
    outputValuesSatoshis,
  };
};
