import { hexDataSlice } from '../../source/utils/ethersV6Compat';
import { getSmartAccountUserOpRequiredPrefund } from '../../source/utils/smartAccount/account';

import type { SmartAccountFeeQuote } from '../../source/shared/smartAccountFeeQuote';
import type { SubmitSmartAccountExecutionsParams } from '../../source/utils/smartAccount/execution';

/** Explicit defaults for older partial unit ports, never production or raw fee-safety cases. */
export const SYNTHETIC_ENTRYPOINT_USER_OPERATION = Object.freeze({
  accountGasLimits: '0x' + '0'.repeat(30) + '01' + '0'.repeat(30) + '01',
  gasFees: '0x' + '0'.repeat(30) + '01' + '0'.repeat(30) + '01',
  preVerificationGas: '1',
});

/** Opt in per fixture. Supplied fields, including malformed values, always win. */
export function withReviewedSmartAccountExecution<
  T extends SubmitSmartAccountExecutionsParams
>(
  params: T,
  defaults: Readonly<{
    payer: SmartAccountFeeQuote['feePayer'];
    userOperation: Record<string, unknown>;
  }>
): T {
  const quotes = new Map<string, SmartAccountFeeQuote>();
  const controllerEmitter: SubmitSmartAccountExecutionsParams['controllerEmitter'] =
    async (methods, payload, ...transport) => {
      if (methods[1] === 'approveSmartAccountExecutionFeeQuote') {
        const quote = quotes.get(payload![0]);
        expect(quote).toBeDefined();
        expect(payload).toEqual([payload![0], quote]);
        return undefined;
      }
      const result = await params.controllerEmitter(
        methods,
        payload,
        ...transport
      );
      if (
        ![
          'prepareSmartAccountExecutions',
          'reuseSmartAccountExecutions',
        ].includes(methods[1]) ||
        !result?.executionContextId
      )
        return result;
      for (const field of ['userOperation', 'gasPayer'])
        if (
          Object.hasOwn(result, field) &&
          (!result[field] ||
            typeof result[field] !== 'object' ||
            Array.isArray(result[field]))
        )
          return result;
      const userOperation = {
        ...defaults.userOperation,
        ...result.userOperation,
      };
      const gasPayer = { ...defaults.payer, ...result.gasPayer };
      const gasUnits =
        BigInt(hexDataSlice(userOperation.accountGasLimits, 0, 16)) +
        BigInt(hexDataSlice(userOperation.accountGasLimits, 16, 32)) +
        BigInt(userOperation.preVerificationGas);
      const quote: SmartAccountFeeQuote = {
        executionContextId: result.executionContextId,
        feePayer: gasPayer,
        gasUnits: gasUnits.toString(),
        maximumFeeWei: getSmartAccountUserOpRequiredPrefund(
          userOperation as any
        ).toString(),
      };
      quotes.set(result.executionContextId, quote);
      return { ...result, userOperation, gasPayer, entryPointFeeQuote: quote };
    };
  return {
    ...params,
    controllerEmitter,
    feeConsent: params.feeConsent ?? {
      async confirmEntryPoint(quote) {
        expect(quotes.get(quote.executionContextId)).toEqual(quote);
        return quote.executionContextId;
      },
      async confirmFee(review) {
        return review.id;
      },
    },
  };
}
