import { ethErrors } from 'helpers/errors';

import { assertDappTypedDataValid } from '../../../../../shared/dappTypedDataValidation.ts';
import cleanErrorStack from 'utils/cleanErrorStack';
import { isTypedDataMethod } from 'utils/requestPayloadBudget';

import type { Middleware } from '../request-pipeline';

export const typedDataValidationMiddleware: Middleware = async (
  context,
  next
) => {
  const { method, params } = context.originalRequest;
  if (!isTypedDataMethod(method)) return next();
  try {
    assertDappTypedDataValid(method, params);
    return next();
  } catch (error) {
    if (error.code && error.message) throw error;
    throw cleanErrorStack(
      ethErrors.rpc.invalidParams(`Invalid typed data: ${error.message}`)
    );
  }
};
