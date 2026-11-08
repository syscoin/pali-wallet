import { normalizeDappTransaction } from './dappTransaction.ts';
import { EthereumProviderErrorHandler } from '../helpers/errors/errorClassesHandlers.ts';
import { errorCodes } from '../helpers/errors/errorConstants.ts';

/** The extension and native Smart paths accept the same external transaction fields. */
export function snapshotSmartAccountDappTransaction(input: unknown) {
  const transaction = normalizeDappTransaction(input);
  const unsupported = (message: string): never => {
    throw new EthereumProviderErrorHandler(
      errorCodes.provider.unsupportedMethod,
      message
    );
  };
  if (transaction.nonce !== undefined)
    unsupported(
      'An explicit transaction nonce is not supported for this account'
    );
  if (transaction.accessList?.length)
    unsupported(
      'Transaction access lists are not supported for smart accounts'
    );
  if (transaction.type === '0x0' || transaction.gasPrice !== undefined)
    unsupported(
      'Smart accounts support EIP-1559 fee overrides, not legacy transaction fees.'
    );
  if (!transaction.to)
    unsupported('Contract deployment is not supported for smart accounts');
  return Object.freeze(transaction);
}
