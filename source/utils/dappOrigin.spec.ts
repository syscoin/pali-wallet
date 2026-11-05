import {
  boundDappSiteLookupText,
  getDappOrigin,
  getDappSiteLookupUrl,
  isTrustedDappOrigin,
  MAX_DAPP_SITE_LOOKUP_LENGTH,
} from './dappOrigin';

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

  it('refuses a long link whose clipped text changes its actual origin', () => {
    const longLink = `https://bridge.syscoin.org${' '.repeat(
      MAX_DAPP_SITE_LOOKUP_LENGTH
    )}@attacker.test`;
    expect(getDappOrigin(longLink)).toBe('https://attacker.test');
    expect(getDappOrigin(longLink.slice(0, MAX_DAPP_SITE_LOOKUP_LENGTH))).toBe(
      'https://bridge.syscoin.org'
    );
    expect(getDappSiteLookupUrl(longLink)).toBeNull();
    expect(getDappSiteLookupUrl(boundDappSiteLookupText(longLink))).toBeNull();
    expect(getDappSiteLookupUrl(' BRIDGE.Syscoin.org/a ')).toBe(
      'https://BRIDGE.Syscoin.org/a'
    );
  });

  it('marks a paste even when a surrogate pair straddles the text limit', () => {
    const origin = 'https://bridge.syscoin.org';
    const prefix = origin.padEnd(MAX_DAPP_SITE_LOOKUP_LENGTH - 1);
    const link = `${prefix}😈@attacker.test`;
    expect(getDappOrigin(link)).toBe('https://attacker.test');
    const bounded = boundDappSiteLookupText(link);
    expect(bounded).toBe(`${prefix}\ufffd…`);
    expect(getDappSiteLookupUrl(bounded)).toBeNull();
  });

  it('does not interpret an email or mailto address as a site', () => {
    expect(getDappSiteLookupUrl('mailto:user@bridge.syscoin.org')).toBeNull();
    expect(getDappSiteLookupUrl('user@bridge.syscoin.org')).toBeNull();
    expect(getDappSiteLookupUrl('bridge.syscoin.org:443/path/@account')).toBe(
      'https://bridge.syscoin.org:443/path/@account'
    );
  });
});
