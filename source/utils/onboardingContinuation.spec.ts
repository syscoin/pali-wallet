import {
  onboardingContinuationPath,
  readOnboardingContinuation,
} from './onboardingContinuation';

const data = JSON.stringify({
  approvalId: 'original-approval',
  host: 'https://synthetic.example',
  eventName: 'connect',
  message: 'Literal # & + % café 🛡',
});
const initialUrl = (route: string, value = data) =>
  `chrome-extension://fixture/external.html?${new URLSearchParams({
    route,
    data: value,
  })}`;

describe('document-local onboarding continuation', () => {
  it.each(['connect-wallet', 'tx/ethSign', 'tx/send/calls', 'login'])(
    'preserves original %s request data without interpreting it',
    (route) => {
      const continuation = readOnboardingContinuation(initialUrl(route));
      expect(continuation).toEqual({ route, data });
      const destination = new URL(
        onboardingContinuationPath(continuation!),
        'chrome-extension://fixture'
      );
      expect(destination.pathname).toBe(`/external/${route}`);
      expect(destination.searchParams.get('data')).toBe(data);
      expect(destination.hash).toBe('');
    }
  );

  it('preserves external identity when private drafts are discarded', () => {
    const continuation = readOnboardingContinuation(
      initialUrl('connect-wallet')
    )!;
    const restart = new URL(
      onboardingContinuationPath(continuation, true),
      'chrome-extension://fixture'
    );
    expect(restart.pathname).toBe('/');
    expect(restart.searchParams.get('externalRoute')).toBe('connect-wallet');
    expect(restart.searchParams.get('data')).toBe(data);
  });

  it.each([
    '/?externalRoute=connect-wallet',
    '/external/connect-wallet',
    '/import',
    '/create-password-import',
  ])('cannot reconstruct continuation from a routed/reloaded %s', (path) => {
    expect(
      readOnboardingContinuation(
        `chrome-extension://fixture${path}${
          path.includes('?') ? '&' : '?'
        }data=${encodeURIComponent(data)}`
      )
    ).toBeUndefined();
  });

  it.each([
    ['https://attacker.example', data],
    ['../home', data],
    ['settings/account/hardware', data],
    ['connect-wallet', '{}'],
    ['connect-wallet', '[]'],
    ['connect-wallet', '{bad'],
    ['connect-wallet', JSON.stringify({ approvalId: 'id', host: 'host' })],
    [
      'connect-wallet',
      JSON.stringify({ approvalId: '', host: 'host', eventName: 'connect' }),
    ],
  ])('rejects unbound or unsupported route %s', (route, value) => {
    expect(
      readOnboardingContinuation(initialUrl(route, value))
    ).toBeUndefined();
  });
});
