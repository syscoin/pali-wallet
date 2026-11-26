import { classifyDappGasEstimateError } from './dappFeeReviewError';

it.each([
  [{ code: 3, message: 'execution reverted' }, 'DAPP_FEE_REVERTED'],
  [
    { code: -32000, message: 'execution reverted: ignored', data: '0x' },
    'DAPP_FEE_REVERTED',
  ],
  [{ code: -32601 }, 'DAPP_FEE_ESTIMATE_UNAVAILABLE'],
  [{ code: -32004 }, 'DAPP_FEE_ESTIMATE_UNAVAILABLE'],
  [{ code: -32000, message: 'execution reverted' }, undefined],
  [{ code: -32002, message: 'temporarily unavailable' }, undefined],
  [{ code: 'DAPP_FEE_REVERTED' }, undefined],
])('classifies only the scoped rejection evidence %j', (input, expected) => {
  expect(classifyDappGasEstimateError(input)?.code).toBe(expected);
});
