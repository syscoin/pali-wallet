jest.unmock('@ethersproject/abi');
jest.unmock('@ethersproject/strings');

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
});
