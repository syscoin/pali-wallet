import { getTypedOrderReview } from './typedOrderReview';

const OFFERER = '0x942db9399f51805f9a84664587210b7ce67e052e';
const OTHER = '0xdfdc0b1cf8e9950d6a860af6501c4fecf7825cc1';
const ZERO = `0x${'00'.repeat(20)}`;
const ZERO_HASH = `0x${'00'.repeat(32)}`;
const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const fields = (entries: [string, string][]) =>
  entries.map(([name, type]) => ({ name, type }));
const domainType = () =>
  fields([
    ['name', 'string'],
    ['version', 'string'],
    ['chainId', 'uint256'],
    ['verifyingContract', 'address'],
  ]);

// Independent fixtures use the actual type graphs from the 0x and Seaport
// protocols, including the examples supplied from MetaMask's test dapp.
const trade = () => ({
  types: {
    ERC721Order: fields([
      ['direction', 'uint8'],
      ['maker', 'address'],
      ['taker', 'address'],
      ['expiry', 'uint256'],
      ['nonce', 'uint256'],
      ['erc20Token', 'address'],
      ['erc20TokenAmount', 'uint256'],
      ['fees', 'Fee[]'],
      ['erc721Token', 'address'],
      ['erc721TokenId', 'uint256'],
      ['erc721TokenProperties', 'Property[]'],
    ]),
    Fee: fields([
      ['recipient', 'address'],
      ['amount', 'uint256'],
      ['feeData', 'bytes'],
    ]),
    Property: fields([
      ['propertyValidator', 'address'],
      ['propertyData', 'bytes'],
    ]),
    EIP712Domain: domainType(),
  },
  domain: {
    name: 'ZeroEx',
    version: '1.0.0',
    chainId: '5700',
    verifyingContract: '0xdef1c0ded9bec7f1a1670819833240f027b25eff',
  },
  primaryType: 'ERC721Order',
  message: {
    direction: '0',
    maker: OFFERER,
    taker: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    expiry: '2524604400',
    nonce:
      '100131415900000000000000000000000000000083840314483690155566137712510085002484',
    erc20Token: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    erc20TokenAmount: '42000000000000',
    fees: [] as any[],
    erc721Token: '0x8a90CAb2b38dba80c64b7734e58Ee1dB38B8992e',
    erc721TokenId: '2516',
    erc721TokenProperties: [] as any[],
  },
});

const seaport = () => {
  const offer = [
    ['0x60e4d786628fea6478f785a6d7e704777c86a7c6', '26464'],
    ['0x60e4d786628fea6478f785a6d7e704777c86a7c6', '7779'],
    ['0x60e4d786628fea6478f785a6d7e704777c86a7c6', '4770'],
    ['0xba30e5f9bb24caa003e9f2f0497ad287fdf95623', '9594'],
    ['0xba30e5f9bb24caa003e9f2f0497ad287fdf95623', '2118'],
    ['0xba30e5f9bb24caa003e9f2f0497ad287fdf95623', '1753'],
  ].map(([token, identifierOrCriteria]) => ({
    itemType: '2',
    token,
    identifierOrCriteria,
    startAmount: '1',
    endAmount: '1',
  }));
  return {
    types: {
      OrderComponents: fields([
        ['offerer', 'address'],
        ['zone', 'address'],
        ['offer', 'OfferItem[]'],
        ['consideration', 'ConsiderationItem[]'],
        ['orderType', 'uint8'],
        ['startTime', 'uint256'],
        ['endTime', 'uint256'],
        ['zoneHash', 'bytes32'],
        ['salt', 'uint256'],
        ['conduitKey', 'bytes32'],
        ['counter', 'uint256'],
      ]),
      OfferItem: fields([
        ['itemType', 'uint8'],
        ['token', 'address'],
        ['identifierOrCriteria', 'uint256'],
        ['startAmount', 'uint256'],
        ['endAmount', 'uint256'],
      ]),
      ConsiderationItem: fields([
        ['itemType', 'uint8'],
        ['token', 'address'],
        ['identifierOrCriteria', 'uint256'],
        ['startAmount', 'uint256'],
        ['endAmount', 'uint256'],
        ['recipient', 'address'],
      ]),
      EIP712Domain: domainType(),
    },
    domain: {
      name: 'Seaport',
      version: '1.1',
      chainId: 5700,
      verifyingContract: '0x00000000006c3852cbef3e08e8df289169ede581',
    },
    primaryType: 'OrderComponents',
    message: {
      offerer: '0x5a6f5477bdeb7801ba137a9f0dc39c0599bac994',
      zone: '0x004c00500000ad104d7dbd00e3ae0a5c00560c00',
      offer,
      consideration: offer.map((item) => ({ ...item, recipient: OTHER })),
      orderType: '2',
      startTime: '1681810415',
      endTime: '1681983215',
      zoneHash: ZERO_HASH,
      salt: '1550213294656772168494388599483486699884316127427085531712538817979596',
      conduitKey:
        '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000',
      counter: '0',
    },
  };
};

const recognized = (protocol: '0x' | 'Seaport', warnings: string[] = []) => ({
  protocol,
  status: 'recognized',
  warnings,
});
const unrecognized = (protocol: '0x' | 'Seaport') => ({
  protocol,
  status: 'unrecognized',
  warnings: [],
});

describe('deterministic typed-order review', () => {
  it.each([trade, seaport])(
    'reviews an object and its exact JSON identically',
    (fixture) => {
      const payload = fixture();
      expect(getTypedOrderReview(JSON.stringify(payload))).toEqual(
        getTypedOrderReview(payload)
      );
    }
  );

  it('does not label the paid test-dapp trade malicious or judge its small price', () => {
    expect(getTypedOrderReview(trade())).toEqual(recognized('0x'));
  });

  it.each(['0', '00', '0x00', 0])(
    'warns for an NFT sale with zero payment encoded as %p',
    (amount) => {
      const payload: any = trade();
      payload.message.erc20TokenAmount = amount;
      expect(getTypedOrderReview(payload)).toEqual(
        recognized('0x', ['send.nftOrderZeroPayment'])
      );
    }
  );

  it('does not treat a zero-price NFT buy order as a sale', () => {
    const payload = trade();
    payload.message.direction = '1';
    payload.message.erc20TokenAmount = '0';
    expect(getTypedOrderReview(payload)).toEqual(recognized('0x'));
  });

  it.each([OTHER, OFFERER])(
    'does not claim zero token payment when a positive fee goes to %s',
    (recipient) => {
      const payload = trade();
      payload.message.erc20TokenAmount = '0';
      payload.message.fees.push({ recipient, amount: '1', feeData: '0x' });
      expect(getTypedOrderReview(payload)).toEqual(recognized('0x'));
    }
  );

  it('allows zero-valued fees without hiding the zero-payment fact', () => {
    const payload = trade();
    payload.message.erc20TokenAmount = '0';
    payload.message.fees.push({ recipient: OTHER, amount: '0', feeData: '0x' });
    expect(getTypedOrderReview(payload)).toEqual(
      recognized('0x', ['send.nftOrderZeroPayment'])
    );
  });

  it('reviews NFT collection properties without treating zero token ID as an identified NFT', () => {
    const payload = trade();
    payload.message.direction = '1';
    payload.message.erc721TokenId = '0';
    payload.message.erc721TokenProperties.push({
      propertyValidator: ZERO,
      propertyData: '0x',
    });
    expect(getTypedOrderReview(payload)).toEqual(recognized('0x'));
  });

  it.each(['1.1', '1.6'])(
    'warns about no required return in the Seaport %s fixture despite its expired timestamp',
    (version) => {
      const payload = seaport();
      payload.domain.version = version;
      expect(getTypedOrderReview(payload)).toEqual(
        recognized('Seaport', ['send.nftOrderNoReturn'])
      );
    }
  );

  it.each(['0', '1', '2', '3'])(
    'does not infer execution safety from Seaport order type %s',
    (orderType) => {
      const payload = seaport();
      payload.message.orderType = orderType;
      expect(getTypedOrderReview(payload)?.warnings).toEqual([
        'send.nftOrderNoReturn',
      ]);
    }
  );

  it('keeps a gift advisory even when there are no consideration items', () => {
    const payload = seaport();
    payload.message.consideration = [];
    expect(getTypedOrderReview(payload)?.warnings).toEqual([
      'send.nftOrderNoReturn',
    ]);
  });

  it.each(['0', '1', '2', '3', '4', '5'])(
    'accepts a positive return of asset type %s without judging its value',
    (itemType) => {
      const payload = seaport();
      payload.message.consideration.push({
        ...payload.message.offer[0],
        itemType,
        recipient: payload.message.offerer.toUpperCase().replace('0X', '0x'),
      });
      expect(getTypedOrderReview(payload)).toEqual(recognized('Seaport'));
    }
  );

  it('does not mistake royalties for a missing seller return in a paid sale', () => {
    const payload = seaport();
    payload.message.consideration = [
      {
        itemType: '1',
        token: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        identifierOrCriteria: '0',
        startAmount: '950',
        endAmount: '950',
        recipient: payload.message.offerer,
      },
      {
        itemType: '1',
        token: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        identifierOrCriteria: '0',
        startAmount: '50',
        endAmount: '50',
        recipient: OTHER,
      },
    ];
    expect(getTypedOrderReview(payload)).toEqual(recognized('Seaport'));
  });

  it.each([
    ['0', '1'],
    ['1', '0'],
  ])(
    'includes a dynamic return with start %s and end %s',
    (startAmount, endAmount) => {
      const payload = seaport();
      payload.message.consideration = [
        {
          ...payload.message.consideration[0],
          startAmount,
          endAmount,
          recipient: payload.message.offerer,
        },
      ];
      expect(getTypedOrderReview(payload)).toEqual(recognized('Seaport'));
    }
  );

  it('does not mistake a zero-amount seller entry for a positive return', () => {
    const payload = seaport();
    payload.message.consideration.push({
      ...payload.message.consideration[0],
      startAmount: '0',
      endAmount: '0',
      recipient: payload.message.offerer,
    });
    expect(getTypedOrderReview(payload)?.warnings).toEqual([
      'send.nftOrderNoReturn',
    ]);
  });

  it.each(['2', '3', '4', '5'])(
    'covers offered NFT type %s, including collection criteria and dynamic quantities',
    (itemType) => {
      const payload = seaport();
      payload.message.offer = [
        {
          ...payload.message.offer[0],
          itemType,
          identifierOrCriteria: MAX_UINT256,
          startAmount: '0',
          endAmount: '1',
        },
      ];
      expect(getTypedOrderReview(payload)?.warnings).toEqual([
        'send.nftOrderNoReturn',
      ]);
    }
  );

  it.each(['0', '1'])(
    'does not use the NFT-specific no-return notice for offered type %s',
    (itemType) => {
      const payload = seaport();
      payload.message.offer.forEach((item) => {
        item.itemType = itemType;
      });
      expect(getTypedOrderReview(payload)).toEqual(recognized('Seaport'));
    }
  );

  it('does not use the no-return notice when every offered amount is zero', () => {
    const payload = seaport();
    payload.message.offer.forEach((item) => {
      item.startAmount = '0';
      item.endAmount = '0';
    });
    expect(getTypedOrderReview(payload)).toEqual(recognized('Seaport'));
  });

  it('does not compare issuer identity to an EOA or infer verifier deployment from addresses', () => {
    const payload = seaport();
    payload.message.offerer = '0x0000000000000000000000000000000000000001';
    payload.domain.verifyingContract = ZERO;
    payload.domain.chainId = 31337;
    expect(getTypedOrderReview(payload)?.warnings).toEqual([
      'send.nftOrderNoReturn',
    ]);
  });

  it.each([
    [
      'altered direction width',
      (p: any) => {
        p.types.ERC721Order[0].type = 'uint256';
      },
    ],
    [
      'reordered fields',
      (p: any) => {
        p.types.ERC721Order.reverse();
      },
    ],
    [
      'altered nested fee type',
      (p: any) => {
        p.types.Fee[1].type = 'uint128';
      },
    ],
    [
      'missing nested property type',
      (p: any) => {
        delete p.types.Property;
      },
    ],
    [
      'extra signed field',
      (p: any) => {
        p.types.ERC721Order.push({ name: 'hidden', type: 'uint256' });
        p.message.hidden = '1';
      },
    ],
    [
      'extra unsigned message field',
      (p: any) => {
        p.message.hidden = '1';
      },
    ],
    [
      'extra unused type',
      (p: any) => {
        p.types.Hidden = [{ name: 'spender', type: 'address' }];
      },
    ],
    [
      'extra domain field',
      (p: any) => {
        p.domain.salt = ZERO_HASH;
      },
    ],
    [
      'altered domain schema',
      (p: any) => {
        p.types.EIP712Domain[2].type = 'string';
      },
    ],
    [
      'extra type-descriptor field',
      (p: any) => {
        p.types.Fee[0].hidden = 'spender';
      },
    ],
    [
      'spoofed protocol name',
      (p: any) => {
        p.domain.name = 'ZeroEx\u0000';
      },
    ],
    [
      'unsupported protocol version',
      (p: any) => {
        p.domain.version = '1.0.1';
      },
    ],
    [
      'extra top-level field',
      (p: any) => {
        p.hidden = { spender: OTHER };
      },
    ],
  ])('declines a partial familiar summary for %s', (_name, change) => {
    const payload: any = trade();
    payload.message.erc20TokenAmount = '0';
    change(payload);
    expect(getTypedOrderReview(payload)).toEqual(unrecognized('0x'));
    expect(getTypedOrderReview(JSON.stringify(payload))).toEqual(
      unrecognized('0x')
    );
  });

  it.each([
    [
      'extra consideration field',
      (p: any) => {
        p.message.consideration[0].hidden = '1';
      },
    ],
    [
      'missing item recipient',
      (p: any) => {
        delete p.message.consideration[0].recipient;
      },
    ],
    [
      'changed offer-item type',
      (p: any) => {
        p.types.OfferItem[0].type = 'string';
      },
    ],
    [
      'invalid enum',
      (p: any) => {
        p.message.offer[0].itemType = '6';
      },
    ],
    [
      'unsupported contract order',
      (p: any) => {
        p.message.orderType = '4';
      },
    ],
    [
      'malformed hash',
      (p: any) => {
        p.message.conduitKey = '0x1234';
      },
    ],
    [
      'unsupported version',
      (p: any) => {
        p.domain.version = '9.0';
      },
    ],
  ])('retains an unrecognized Seaport review for %s', (_name, change) => {
    const payload: any = seaport();
    change(payload);
    expect(getTypedOrderReview(payload)).toEqual(unrecognized('Seaport'));
  });

  it.each([
    '',
    '-1',
    '+1',
    ' 0 ',
    '1.5',
    '1e18',
    '0x',
    '0xzz',
    '0x1.0',
    '115792089237316195423570985008687907853269984665640564039457584007913129639936',
    `0x1${'00'.repeat(32)}`,
    Number.MAX_SAFE_INTEGER + 1,
    0.5,
    Infinity,
    null,
    true,
    BigInt(0),
  ])('rejects a malformed or inexact unsigned amount %p', (amount) => {
    const payload: any = trade();
    payload.message.erc20TokenAmount = amount;
    expect(getTypedOrderReview(payload)).toEqual(unrecognized('0x'));
  });

  it.each([MAX_UINT256, `0x${'ff'.repeat(32)}`, Number.MAX_SAFE_INTEGER])(
    'preserves the exact unsigned amount %p',
    (amount) => {
      const payload: any = trade();
      payload.message.erc20TokenAmount = amount;
      expect(getTypedOrderReview(payload)).toEqual(recognized('0x'));
    }
  );

  it.each([
    [
      'invalid address',
      (p: any) => {
        p.message.maker = '0x1234';
      },
    ],
    [
      'invalid chain',
      (p: any) => {
        p.domain.chainId = 'invalid';
      },
    ],
    [
      'invalid direction',
      (p: any) => {
        p.message.direction = '2';
      },
    ],
    [
      'invalid fee bytes',
      (p: any) => {
        p.message.fees = [{ recipient: OTHER, amount: '0', feeData: '0x0' }];
      },
    ],
    [
      'invalid property bytes',
      (p: any) => {
        p.message.erc721TokenProperties = [
          { propertyValidator: ZERO, propertyData: 'invalid' },
        ];
      },
    ],
    [
      'oversized callback bytes',
      (p: any) => {
        p.message.fees = [
          { recipient: OTHER, amount: '0', feeData: `0x${'ff'.repeat(2048)}` },
        ];
      },
    ],
    [
      'oversized fees',
      (p: any) => {
        p.message.fees = Array.from({ length: 65 }, () => ({
          recipient: OTHER,
          amount: '0',
          feeData: '0x',
        }));
      },
    ],
    [
      'sparse fees',
      (p: any) => {
        p.message.fees = new Array(1);
      },
    ],
    [
      'oversized string',
      (p: any) => {
        p.message.nonce = '0'.repeat(65537);
      },
    ],
  ])('declines semantic interpretation for %s', (_name, change) => {
    const payload: any = trade();
    change(payload);
    expect(getTypedOrderReview(payload)).toEqual(unrecognized('0x'));
  });

  it('accepts the bounded array limit but does not summarize a truncated list beyond it', () => {
    const payload = seaport();
    payload.message.offer = Array.from({ length: 64 }, () => ({
      ...payload.message.offer[0],
    }));
    expect(getTypedOrderReview(payload)?.status).toBe('recognized');
    payload.message.offer.push({ ...payload.message.offer[0] });
    expect(getTypedOrderReview(payload)).toEqual(unrecognized('Seaport'));
  });

  it('does not parse oversized JSON or pretend that it passed semantic review', () => {
    const payload = trade();
    const encoded = JSON.stringify(payload);
    expect(getTypedOrderReview(`${encoded}${' '.repeat(65537)}`)).toBeNull();
  });

  it.each([
    null,
    undefined,
    1,
    [],
    {},
    '{broken JSON',
    JSON.stringify({ primaryType: 'Permit' }),
  ])('leaves unknown or malformed general messages alone: %p', (payload) => {
    expect(getTypedOrderReview(payload)).toBeNull();
  });

  it('does not execute accessors or serialization hooks during review', () => {
    const payload = trade();
    const getter = jest.fn(() => '0');
    Object.defineProperty(payload.message, 'erc20TokenAmount', {
      enumerable: true,
      get: getter,
    });
    expect(getTypedOrderReview(payload)).toEqual(unrecognized('0x'));
    expect(getter).not.toHaveBeenCalled();

    const withSerializationHook: any = trade();
    withSerializationHook.toJSON = jest.fn(() => trade());
    expect(getTypedOrderReview(withSerializationHook)).toEqual(
      unrecognized('0x')
    );
    expect(withSerializationHook.toJSON).not.toHaveBeenCalled();
  });

  it('does not mutate frozen signing input or carry warnings into a later request', () => {
    const payload = seaport();
    const freeze = (value: any) => {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    };
    const before = JSON.stringify(payload);
    freeze(payload);
    expect(getTypedOrderReview(payload)?.warnings).toEqual([
      'send.nftOrderNoReturn',
    ]);
    expect(JSON.stringify(payload)).toBe(before);
    expect(getTypedOrderReview(trade())).toEqual(recognized('0x'));
  });
});
