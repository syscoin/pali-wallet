import { getSyscoinPsbtValueSummary } from './syscoinPsbtValues';

describe('Syscoin PSBT value summary', () => {
  it('computes the exact fee and output values from witness inputs', () => {
    const summary = getSyscoinPsbtValueSummary({
      data: {
        inputs: [
          { witnessUtxo: { value: BigInt('9007199254740991') } },
          { witnessUtxo: { value: BigInt(1000) } },
        ],
      },
      txInputs: [{ index: 0 }, { index: 1 }],
      txOutputs: [
        { value: BigInt('9007199254740000') },
        { value: BigInt(500) },
      ],
    });

    expect(summary).toEqual({
      feeSatoshis: '1491',
      outputValuesSatoshis: ['9007199254740000', '500'],
    });
  });

  it('fails closed when an input value is unavailable', () => {
    expect(() =>
      getSyscoinPsbtValueSummary({
        data: { inputs: [{}] },
        txInputs: [{ index: 0 }],
        txOutputs: [{ value: BigInt(1) }],
      })
    ).toThrow('Unable to verify PSBT input 0');
  });

  it('rejects outputs whose value exceeds the inputs', () => {
    expect(() =>
      getSyscoinPsbtValueSummary({
        data: { inputs: [{ witnessUtxo: { value: BigInt(1) } }] },
        txInputs: [{ index: 0 }],
        txOutputs: [{ value: BigInt(2) }],
      })
    ).toThrow('PSBT outputs exceed its inputs');
  });
});
