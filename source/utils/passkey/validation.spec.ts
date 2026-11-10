import { validatePasskeyClientDataJSON } from './validation';

describe('P-256 WebAuthn validation utilities', () => {
  it('validates WebAuthn client data offsets for the P-256 module', () => {
    const challenge = 'abc';
    const origin = 'https://pali.wallet';
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        challenge,
        origin,
        type: 'webauthn.get',
      })
    );

    const result = validatePasskeyClientDataJSON(
      clientDataJSON,
      challenge,
      origin
    );

    expect(result.challengeOffset).toBeGreaterThan(0);
    expect(result.originOffset).toBeGreaterThan(0);
    expect(result.typeOffset).toBeGreaterThan(0);
  });
  it('preserves smart-account byte offsets after a multibyte field', () => {
    const origin = 'https://pali.wallet';
    const challenge = 'abc';
    const type = 'webauthn.get';
    const bytes = Buffer.from(
      JSON.stringify({ display: '🧪', challenge, origin, type })
    );

    expect(validatePasskeyClientDataJSON(bytes, challenge, origin)).toEqual({
      clientDataText: bytes.toString(),
      challengeOffset: bytes.indexOf(challenge),
      originOffset: bytes.indexOf(origin),
      typeOffset: bytes.indexOf(type),
    });
  });
});
