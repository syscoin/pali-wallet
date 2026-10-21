jest.unmock('syscoinjs-lib');
// Loading the published SDK must not initialize a physical-device transport.
// Its real descriptor checksum and all identifier validation remain in use.
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));

import { sha256 } from 'ethers/crypto';
import { decodeBase58, encodeBase58, getBytes, toBeHex } from 'ethers/utils';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import { isPublicWatchOnlyIdentifier } from './watchOnlyIdentifier';

const PUBLIC_KEY =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const XPUB =
  'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';
const XPRV =
  'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi';
const WIF = 'L4rK1yDtCWekvXuE6oXD9jCYfFNV2cWRpVuPLBcCU2z8TrisoyY1';
const ADDRESS = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';

it.each([
  ['xpub', '0488b21e'],
  ['tpub', '043587cf'],
  ['ypub', '049d7cb2'],
  ['zpub', '04b24746'],
  ['Ypub', '0295b43f'],
  ['Zpub', '02aa7ed3'],
  ['upub', '044a5262'],
  ['vpub', '045f1cf6'],
  ['Upub', '024289ef'],
  ['Vpub', '02575483'],
])(
  'accepts checksum-valid %s public keys and their descriptor paths',
  (prefix, version) => {
    const source = getBytes(toBeHex(decodeBase58(XPUB)));
    const payload = Buffer.concat([
      Buffer.from(version, 'hex'),
      Buffer.from(source.slice(4, 78)),
    ]);
    const checksum = getBytes(sha256(sha256(payload))).slice(0, 4);
    const publicKey = encodeBase58(Buffer.concat([payload, checksum]));
    expect(publicKey.startsWith(prefix)).toBe(true);
    expect(isPublicWatchOnlyIdentifier(publicKey)).toBe(true);
    expect(
      isPublicWatchOnlyIdentifier(`wpkh([d34db33f/84h/1h/0h]${publicKey}/0/*)`)
    ).toBe(true);
  }
);

it.each([
  ADDRESS,
  '0x1111111111111111111111111111111111111111',
  syscoinUtils.bitcoinjs.address.toBech32(
    new Uint8Array(20).fill(1),
    0,
    'tsys'
  ),
  syscoinUtils.bitcoinjs.address.toBech32(new Uint8Array(32).fill(1), 1, 'bc'),
  XPUB,
  `addr(${ADDRESS})`,
  `pkh(${PUBLIC_KEY})`,
  `wpkh(${PUBLIC_KEY})`,
  `combo(${PUBLIC_KEY})`,
  `sh(wpkh(${XPUB}/0/*))`,
  `wpkh([d34db33f/84h/1h/0h]${XPUB}/<0;1>/*)`,
  `wsh(sortedmulti(2,${PUBLIC_KEY},${XPUB}/0/*))`,
  `tr(${PUBLIC_KEY.slice(2)},{pk(${PUBLIC_KEY}),pk(${PUBLIC_KEY})})`,
  // Public descriptor/checksum vector retained in Core's descriptor_tests.cpp.
  "sh(multi(2,[00000000/111'/222]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL,xpub68NZiKmJWnxxS6aaHmn81bvJeTESw724CRDs6HbuccFQN9Ku14VQrADWgqbhhTHBaohPX4CjNLf9fq9MYo6oDaPPLPxSb7gwQN3ih19Zm4Y/0))#tjg09x5t",
])('accepts a supported public identifier (case %#)', (value) => {
  expect(isPublicWatchOnlyIdentifier(value)).toBe(true);
});

it.each([
  undefined,
  '',
  'arbitrary identifier',
  `0x${'11'.repeat(32)}`,
  '11'.repeat(32),
  WIF,
  XPRV,
  `wpkh(${WIF})`,
  `sh(wpkh(${XPRV}/0/*))`,
  `wsh(multi(2,${PUBLIC_KEY},${XPRV}/0/*))`,
  `wpkh([d34db33f/84h/1h/0h]${XPRV}/0/*)`,
  `wpkh(${XPUB})tr(${PUBLIC_KEY})`,
  `wpkh(${XPUB})#aaaaaaaa`,
  `wpkh(${XPUB.slice(0, -1)}1)`,
  '1BoatSLRHtKNngkdXEeobR76b53LETtpy1',
  `wpkh(${'11'.repeat(32)})`,
  `wpkh(02${'ff'.repeat(32)})`,
  `addr(${WIF})`,
  `wpkh(${XPUB})#`,
  'x'.repeat(16385),
])(
  'rejects private, malformed or unbounded input without I/O (case %#)',
  (value) => {
    expect(isPublicWatchOnlyIdentifier(value)).toBe(false);
  }
);
