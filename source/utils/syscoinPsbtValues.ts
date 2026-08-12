import * as syscoinjs from 'syscoinjs-lib';

const toBigIntValue = (value: unknown, field: string): bigint => {
  const normalized = String(value);
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Unable to verify ${field}`);
  }
  return BigInt(normalized);
};

export const getSyscoinPsbtValueSummary = (
  psbt: any
): { feeSatoshis: string; outputValuesSatoshis: string[] } => {
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

    if (input.witnessUtxo?.value !== undefined) {
      inputValue = input.witnessUtxo.value;
    } else if (input.nonWitnessUtxo) {
      const previousTransaction =
        syscoinjs.utils.bitcoinjs.Transaction.fromBuffer(input.nonWitnessUtxo);
      inputValue =
        previousTransaction.outs?.[psbt.txInputs[index].index]?.value;
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

  return {
    feeSatoshis: (totalInput - totalOutput).toString(),
    outputValuesSatoshis,
  };
};
