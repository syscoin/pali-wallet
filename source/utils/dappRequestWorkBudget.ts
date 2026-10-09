import { assertPsbtWorkBudget } from './psbtWorkBudget';
import { assertProviderRequestBudget } from './requestPayloadBudget';
import { assertTypedDataParamsWorkBudget } from './typedDataWorkBudget';

export const assertDappRequestWorkBudget = (request: {
  method: string;
  params?: any;
}): void => {
  assertProviderRequestBudget(request);
  assertTypedDataParamsWorkBudget(request.method, request.params);
  if (request.method === 'sys_sign' || request.method === 'sys_signAndSend') {
    assertPsbtWorkBudget(
      Array.isArray(request.params) ? request.params[0] : request.params
    );
  }
};
