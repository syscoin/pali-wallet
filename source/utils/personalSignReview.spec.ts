import {
  getPersonalSignReview,
  isValidPersonalSignMessage,
} from './personalSignReview';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const ORIGIN = 'https://metamask.github.io';
const message = (header = 'metamask.github.io', address = ADDRESS) =>
  `${header} wants you to sign in with your Ethereum account:\n${address}\n\nI accept the MetaMask Terms of Service: https://community.metamask.io/tos\n\nURI: https://metamask.github.io\nVersion: 1\nChain ID: 1\nNonce: 32891757\nIssued At: 2021-09-30T16:25:24.000Z`;
const encode = (value: string) => `0x${Buffer.from(value).toString('hex')}`;

describe.each([
  ['plain', (value: string) => value],
  ['encoded', encode],
] as const)('personal_sign SIWE review (%s)', (_name, payload) => {
  it.each([
    'metamask.github.io',
    'https://metamask.github.io',
    'https://METAMASK.github.io:443',
  ])('accepts a matching HTTPS origin expressed as %s', (header) => {
    const text = message(header);
    expect(getPersonalSignReview(payload(text), ORIGIN, ADDRESS)).toEqual({
      message: text,
    });
  });

  it('accepts all optional fields and resources without checking session expiry', () => {
    const text = `${message()}\nExpiration Time: 2022-03-17T12:45:13.610Z\nNot Before: 2022-03-17T12:45:13.610Z\nRequest ID: some_id\nResources:\n- ipfs://Qme7ss3ARVgxv6rXqVPiikMJ8u2NLgmgszg13pYrDKEoiu\n- https://example.com/my-web2-claim.json`;
    expect(
      getPersonalSignReview(payload(text), ORIGIN, ADDRESS).error
    ).toBeUndefined();
  });

  it.each([
    'metamask.badactor.io',
    'metamask.github.io.attacker.test',
    'www.metamask.github.io',
    'metamask.github.io:8443',
    'http://metamask.github.io',
    'https://user@metamask.github.io',
    'https://user:password@metamask.github.io',
    'https://metamask.github.io/',
    'https://metamask.github.io/path',
    'https://metamask.github.io?site=example.com',
    'https://metamask.github.io#example.com',
    'https://metamask.github.io\\attacker.test',
    'https://metamask.github.io:65536',
    'https://metamask.github.io:',
    'https:///metamask.github.io',
    'https://metamask.github.io%2fattacker.test',
    'https://metamask.github.io%00',
    'https://metamask.github.io%xx',
    'ftp://metamask.github.io',
  ])('rejects a different origin or malformed authority %s', (header) => {
    expect(
      getPersonalSignReview(payload(message(header)), ORIGIN, ADDRESS).error
    ).toBe('send.suspiciousSignInRequest');
  });

  it('rejects an embedded address different from the actual signer', () => {
    expect(
      getPersonalSignReview(
        payload(message(undefined, `0x${'22'.repeat(20)}`)),
        ORIGIN,
        ADDRESS
      ).error
    ).toBe('send.signingForWrongAddress');
  });

  it.each([
    message().replace('URI: https://metamask.github.io\n', ''),
    message().replace(
      'URI: https://metamask.github.io',
      'URI: https://user@@example.com'
    ),
    message().replace(
      'URI: https://metamask.github.io',
      'URI: https://example.com/invalid%xx'
    ),
    message().replace(
      'URI: https://metamask.github.io',
      'URI: https://example.com/#first#second'
    ),
    message().replace('URI: https://metamask.github.io', 'URI: https://[::::]'),
    message().replace('Version: 1', 'Version: 2'),
    message().replace('Chain ID: 1', 'Chain ID: invalid'),
    message().replace('Nonce: 32891757', 'Nonce: short'),
    message().replace('2021-09-30', '2021-02-29'),
    message().replace(ADDRESS, '0x1234'),
    message().replaceAll('\n', '\r\n'),
    `prefix\n${message()}`,
    `${message()}\nignored data`,
    `${message()}\nResources:\n- not-a-uri`,
    `${message()}\nRequest ID: invalid%xx`,
    message().replace('I accept', 'I accépt'),
  ])('fails closed for a malformed SIWE-looking message', (text) => {
    expect(getPersonalSignReview(payload(text), ORIGIN, ADDRESS).error).toBe(
      'send.suspiciousSignInRequest'
    );
  });
});

it.each([
  ['example.com:8443', 'https://example.com:8443'],
  ['http://localhost:8080', 'http://localhost:8080'],
  ['https://[::1]:443', 'https://[::1]'],
  ['https://xn--bcher-kva.example', 'https://xn--bcher-kva.example'],
])('compares the complete normalized origin for %s', (header, origin) => {
  expect(
    getPersonalSignReview(message(header), origin, ADDRESS).error
  ).toBeUndefined();
});

it('does not equate an implicit HTTPS header to HTTP or omit a nondefault port', () => {
  expect(
    getPersonalSignReview(
      message('localhost:8080'),
      'http://localhost:8080',
      ADDRESS
    ).error
  ).toBeDefined();
  expect(
    getPersonalSignReview(
      message('example.com'),
      'https://example.com:8443',
      ADDRESS
    ).error
  ).toBeDefined();
});

it.each([
  ['Hello Pali', 'Hello Pali'],
  [encode('Hello Pali'), 'Hello Pali'],
  ['0xdeadbeef', '0xdeadbeef'],
  ['Hello Pali 日本語', 'Hello Pali 日本語'],
  ['0Xmalformed', '0Xmalformed'],
  ['0x', '0x'],
  ['0xAbCd', '0xAbCd'],
  [ADDRESS, ADDRESS],
])('preserves ordinary personal_sign review for %s', (payload, display) => {
  expect(getPersonalSignReview(payload, ORIGIN, ADDRESS)).toEqual({
    message: display,
  });
});

it.each([
  '0xmalformed',
  '0xabc',
  '0x123z45',
  '0x1234\n',
  `${encode(message('victim.example'))}zz`,
  `${encode(message('victim.example'))}a`,
  `${encode(message(undefined, `0x${'22'.repeat(20)}`))}zz`,
])('rejects ambiguous signing bytes before SIWE parsing: %s', (payload) => {
  expect(isValidPersonalSignMessage(payload)).toBe(false);
  expect(getPersonalSignReview(payload, ORIGIN, ADDRESS)).toEqual({
    message: payload,
    error: 'send.invalidPersonalSignMessage',
  });
});

it.each([null, undefined, 123, {}, ['Hello Pali']])(
  'rejects a non-string signing message: %p',
  (payload) => {
    expect(isValidPersonalSignMessage(payload)).toBe(false);
    expect(getPersonalSignReview(payload, ORIGIN, ADDRESS)).toEqual({
      message: '',
      error: 'send.invalidPersonalSignMessage',
    });
  }
);

it('supports omitted and explicitly empty statements permitted by ERC-4361', () => {
  const withoutStatement = message().replace(
    'I accept the MetaMask Terms of Service: https://community.metamask.io/tos\n',
    ''
  );
  expect(
    getPersonalSignReview(withoutStatement, ORIGIN, ADDRESS).error
  ).toBeUndefined();
  expect(
    getPersonalSignReview(
      withoutStatement.replace('\n\nURI:', '\n\n\nURI:'),
      ORIGIN,
      ADDRESS
    ).error
  ).toBeUndefined();
});

it('accepts RFC3986 URI forms without conflating resources with the requesting origin', () => {
  const text = `${message()}\nRequest ID: name%20with%20spaces\nResources:\n- urn:example:resource\n- https://user:pass@[::1]:8443/path?query=a/b?c#fragment\n- custom://[v1.host:future]/path`;
  expect(getPersonalSignReview(text, ORIGIN, ADDRESS).error).toBeUndefined();
});
