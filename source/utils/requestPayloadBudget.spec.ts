import {
  assertJsonWorkBudget,
  assertProviderRequestBudget,
  DAPP_REQUEST_LIMITS,
} from './requestPayloadBudget';

describe('dapp JSON work budget', () => {
  it('accepts ordinary requests without changing the data', () => {
    const request = {
      method: 'personal_sign',
      params: ['literal # message', '0x123'],
    };
    const before = JSON.stringify(request);
    expect(() => assertProviderRequestBudget(request)).not.toThrow();
    expect(JSON.stringify(request)).toBe(before);
  });

  it('counts UTF-8, escaped characters and keys rather than only string length', () => {
    expect(() => assertJsonWorkBudget('é', 4)).not.toThrow();
    expect(() => assertJsonWorkBudget('é', 3)).toThrow('bytes');
    expect(() => assertJsonWorkBudget('\u0000', 7)).toThrow('bytes');
    expect(() => assertJsonWorkBudget('😀', 6)).not.toThrow();
    expect(() => assertJsonWorkBudget('\ud800', 7)).toThrow('bytes');
    expect(() => assertJsonWorkBudget({ ['a'.repeat(100)]: 1 }, 50)).toThrow(
      'bytes'
    );
  });

  it('rejects enormous strings before serialization', () => {
    expect(() =>
      assertProviderRequestBudget({
        method: 'personal_sign',
        params: ['a'.repeat(DAPP_REQUEST_LIMITS.signingBytes + 1)],
      })
    ).toThrow('bytes');
  });

  it('stops deep trees without recursive traversal', () => {
    let data: any = 'leaf';
    for (let i = 0; i < 10_000; i++) data = { child: data };
    expect(() => assertJsonWorkBudget(data)).toThrow('depth');
  });

  it('bounds wide objects and enormous sparse arrays before enumerating every item', () => {
    expect(() =>
      assertJsonWorkBudget(
        Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [i, 0]))
      )
    ).toThrow('values');
    expect(() => assertJsonWorkBudget(new Array(100_000_000))).toThrow(
      'values'
    );
    expect(() =>
      assertJsonWorkBudget(Array.from({ length: 1000 }, () => new Array(8000)))
    ).toThrow('values');
    expect(() => assertJsonWorkBudget(new Array(100), 100)).toThrow('bytes');
  });

  it('counts repeated object references by occurrence and rejects cycles', () => {
    const shared = { value: 'hello' };
    expect(() => assertJsonWorkBudget([shared, shared], 100, 32, 4)).toThrow(
      'values'
    );
    expect(() => assertJsonWorkBudget([shared, shared])).not.toThrow();
    const cycle: any = {};
    cycle.self = cycle;
    expect(() => assertJsonWorkBudget(cycle)).toThrow('cyclic');
  });

  it('rejects getters and opaque data without invoking them', () => {
    const get = jest.fn();
    const object = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get,
    });
    expect(() => assertJsonWorkBudget(object)).toThrow('accessor');
    expect(get).not.toHaveBeenCalled();
    expect(() => assertJsonWorkBudget(new Uint8Array(1))).toThrow('non-JSON');
    expect(() => assertJsonWorkBudget(new ArrayBuffer(10_000_000))).toThrow(
      'non-JSON'
    );
    const toJSON = jest.fn();
    expect(() =>
      assertJsonWorkBudget(
        Object.defineProperty({}, 'toJSON', { value: toJSON })
      )
    ).toThrow('custom JSON');
    expect(toJSON).not.toHaveBeenCalled();
    expect(() =>
      assertJsonWorkBudget({ toJSON: 'ordinary field' })
    ).not.toThrow();
  });

  it('accepts fifty batch calls and rejects fifty-one without truncation', () => {
    const calls = Array.from({ length: 50 }, () => ({
      to: '0x123',
      data: '0x',
    }));
    expect(() =>
      assertProviderRequestBudget({
        method: 'wallet_sendCalls',
        params: [{ calls }],
      })
    ).not.toThrow();
    calls.push({ to: '0x456', data: '0x' });
    expect(() =>
      assertProviderRequestBudget({
        method: 'wallet_sendCalls',
        params: [{ calls }],
      })
    ).toThrow('50 calls');
    expect(calls).toHaveLength(51);
  });
});
