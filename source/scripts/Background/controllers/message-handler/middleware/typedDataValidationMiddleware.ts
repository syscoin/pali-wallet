import { ethErrors } from 'helpers/errors';

import { assertDappTypedDataValid } from '../../../../../shared/dappTypedDataValidation.ts';
import store from 'state/store';
import { KeyringAccountType } from 'types/network';
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
    const { activeAccount, activeNetwork } = store.getState().vault;
    assertDappTypedDataValid(
      method,
      params,
      activeAccount.type === KeyringAccountType.SmartAccount
        ? undefined
        : activeNetwork.chainId
    );
    return next();
  } catch (error) {
    if (error.code && error.message) throw error;
    throw cleanErrorStack(
      ethErrors.rpc.invalidParams(`Invalid typed data: ${error.message}`)
    );
  }
};
