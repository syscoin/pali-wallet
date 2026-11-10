import {
  isSmartAccountModuleRequestMethod,
  normalizeSmartAccountModuleRequest,
  SMART_ACCOUNT_MODULE_REQUEST_METHODS,
  SmartAccountModuleRequestError,
} from './smartAccountModuleRequest';

describe.each(SMART_ACCOUNT_MODULE_REQUEST_METHODS)(
  '%s raw request',
  (method) => {
    it.each([
      {},
      { address: undefined, name: undefined, initData: undefined },
      { address: '', name: '', initData: '' },
      {
        address: ' invalid address ',
        name: ' '.repeat(121),
        initData: 'not-hex',
      },
    ])(
      'preserves optional raw string fields and defers semantic checks: %p',
      (module) => {
        const expected = Object.fromEntries(
          Object.entries(module).filter(([, value]) => value !== undefined)
        );
        const parsed = normalizeSmartAccountModuleRequest(method, [module]);
        expect(parsed).toEqual({
          method,
          action: method.endsWith('Uninstall') ? 'uninstall' : 'install',
          module: expected,
        });
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(Object.isFrozen(parsed.module)).toBe(true);
      }
    );

    it('accepts direct objects and only the first parameter without retaining caller state', () => {
      const input = {
        address: 'public-address',
        name: 'Public module',
        initData: '0x',
      };
      const direct = normalizeSmartAccountModuleRequest(method, input);
      const array = normalizeSmartAccountModuleRequest(method, [
        input,
        { address: 123 },
        null,
      ]);
      expect(array).toEqual(direct);
      input.address = 'replacement';
      expect(direct.module.address).toBe('public-address');
      expect(array.module.address).toBe('public-address');
    });

    it('copies only public fields and never reads remote acknowledgement or authority bits', () => {
      const input = {
        address: 'public-address',
        privateKey: 'secret',
        executions: [{}],
        preflight: { ok: true },
        acknowledged: true,
      };
      Object.defineProperty(input, 'riskAcknowledged', {
        enumerable: true,
        get: () => {
          throw new Error('Remote consent must not be read');
        },
      });
      expect(
        normalizeSmartAccountModuleRequest(method, [input]).module
      ).toEqual({ address: 'public-address' });
      expect(
        normalizeSmartAccountModuleRequest(method, [
          { riskAcknowledged: true, acknowledged: true },
        ]).module
      ).toEqual({});
    });

    it('preserves the existing optional inherited string-field behavior', () => {
      const input = Object.create({ address: 'inherited-address' });
      expect(normalizeSmartAccountModuleRequest(method, input).module).toEqual({
        address: 'inherited-address',
      });
    });

    it.each([
      [undefined],
      [null],
      [false],
      [123],
      ['address'],
      [[]],
      [[null]],
      [[[]]],
      [[{ address: null }]],
      [[{ address: 123 }]],
      [[{ name: {} }]],
      [[{ name: false }]],
      [[{ initData: [] }]],
      [[{ initData: 0 }]],
    ])('rejects malformed first module fields: %p', (params) => {
      expect(() => normalizeSmartAccountModuleRequest(method, params)).toThrow(
        SmartAccountModuleRequestError
      );
      try {
        normalizeSmartAccountModuleRequest(method, params);
      } catch (error) {
        expect(error).toMatchObject({
          code: -32602,
          message: 'Invalid smart account module',
        });
      }
    });
  }
);

it('recognizes exactly the two module-management RPC methods', () => {
  expect(SMART_ACCOUNT_MODULE_REQUEST_METHODS).toEqual([
    'wallet_requestSmartAccountModuleInstall',
    'wallet_requestSmartAccountModuleUninstall',
  ]);
  expect(Object.isFrozen(SMART_ACCOUNT_MODULE_REQUEST_METHODS)).toBe(true);
  for (const method of SMART_ACCOUNT_MODULE_REQUEST_METHODS)
    expect(isSmartAccountModuleRequestMethod(method)).toBe(true);
  for (const method of [
    undefined,
    null,
    1,
    'wallet_getSmartAccountModules',
    'wallet_prepareSmartAccount',
    'wallet_requestSmartAccountModuleInstallExtra',
  ]) {
    expect(isSmartAccountModuleRequestMethod(method)).toBe(false);
    expect(() => normalizeSmartAccountModuleRequest(method, [{}])).toThrow(
      'Invalid smart account module'
    );
  }
});
