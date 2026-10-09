import { getDappOrigin, isTrustedDappOrigin } from './dappOrigin';

describe('dapp origin identities', () => {
  it('retains scheme and non-default port without paths or credentials', () => {
    expect(getDappOrigin('https://user:pass@example.com:443/path')).toBe(
      'https://example.com'
    );
    expect(getDappOrigin('http://example.com:8080/path')).toBe(
      'http://example.com:8080'
    );
    expect(getDappOrigin('http://example.com')).not.toBe(
      getDappOrigin('https://example.com')
    );
  });

  it.each([
    'example.com',
    'file:///tmp/page.html',
    'data:text/html,test',
    'about:blank',
  ])('rejects non-web or legacy identity %s', (url) => {
    expect(getDappOrigin(url)).toBeNull();
  });

  it('does not trust lookalike hosts, insecure sites or unexpected ports', () => {
    const trusted = ['bridge.syscoin.org'];
    expect(isTrustedDappOrigin('https://bridge.syscoin.org', trusted)).toBe(
      true
    );
    for (const origin of [
      'http://bridge.syscoin.org',
      'https://bridge.syscoin.org.attacker.test',
      'https://fake-bridge.syscoin.org',
      'https://bridge.syscoin.org:8443',
      'https://attacker.test/bridge.syscoin.org',
    ]) {
      expect(isTrustedDappOrigin(origin, trusted)).toBe(false);
    }
  });
});
