import type { TFunction } from 'i18next';

// Only Pali's exact app-owned guidance is translated. Unknown SDK/provider
// diagnostics keep their original text; classification and retries stay in
// MainController.getRpc, including its existing no-retry authentication path.
const RPC_AUTHENTICATION_GUIDANCE =
  'This RPC endpoint requires authentication. Please use an RPC URL that includes your API key or choose a different provider.';

export const translateRpcValidationError = (
  message: string,
  t: TFunction
): string =>
  message === RPC_AUTHENTICATION_GUIDANCE
    ? t('settings.rpcAuthenticationRequired')
    : message;
