// Request metadata stays in the original approval document. It is not an
// authorization: the background still binds the document and approval ID.
export type OnboardingContinuation = Readonly<{
  data: string;
  route: string;
}>;

const approvalRoutes = new Set(
  'add-EthChain|change-account|change-active-connected-account|connect-wallet|login|sentry-link|sentry-operation|sentry-vote|smart-account|smart-account-modules|switch-EthChain|switch-network|switch-UtxoEvm|tx/calls-status|tx/decrypt|tx/encryptKey|tx/ethSign|tx/send/calls|tx/send/ethTx|tx/sign|tx/sign-psbt|watch-asset'.split(
    '|'
  )
);

export const readOnboardingContinuation = (
  documentUrl: string
): OnboardingContinuation | undefined => {
  try {
    const url = new URL(documentUrl);
    // Capture once, before ExternalQueryHandler changes this document's path.
    // Reloading an already-routed page cannot reconstruct the continuation.
    if (url.pathname !== '/external.html') return undefined;
    const route = url.searchParams.get('route');
    const data = url.searchParams.get('data');
    if (!route || !approvalRoutes.has(route) || !data) return undefined;
    const request = JSON.parse(data);
    if (
      !request ||
      typeof request !== 'object' ||
      Array.isArray(request) ||
      !['approvalId', 'host', 'eventName'].every(
        (key) => typeof request[key] === 'string' && request[key]
      )
    )
      return undefined;
    return { route, data };
  } catch {
    return undefined;
  }
};

export const onboardingContinuationPath = (
  continuation: OnboardingContinuation,
  restart = false
) => {
  const query = new URLSearchParams({ data: continuation.data });
  if (restart) query.set('externalRoute', continuation.route);
  // In particular, login resumes its normal explicit authentication screen;
  // it must not hit ExternalQueryHandler's already-unlocked auto-close path.
  return `${restart ? '/' : `/external/${continuation.route}`}?${query}`;
};
