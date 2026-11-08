import { typedDataValidationMiddleware } from '../source/scripts/Background/controllers/message-handler/middleware/typedDataValidationMiddleware';
import {
  MethodHandlerType,
  NetworkPreference,
  NetworkEnforcement,
} from '../source/scripts/Background/controllers/message-handler/types';
import { assertDappTypedDataValid } from '../source/shared/dappTypedDataValidation';

describe.each([
  { name: 'extension middleware', validate: typedDataValidationMiddleware },
  {
    name: 'shared validation',
    validate: async (context: any, next: () => Promise<void>) => {
      const { method, params } = context.originalRequest;
      assertDappTypedDataValid(method, params);
      return next();
    },
  },
])('$name typed-data validation', ({ validate }) => {
  const createMockContext = (params: any[]) =>
    ({
      originalRequest: {
        method: 'eth_signTypedData_v4',
        params,
        host: 'test.com',
        sender: { tab: { id: 1 }, origin: 'test.com' },
        type: 'external',
      },
      methodConfig: {
        name: 'eth_signTypedData_v4',
        handlerType: MethodHandlerType.Eth,
        allowHardwareWallet: true,
        hasPopup: true,
        networkPreference: NetworkPreference.EVM,
        networkEnforcement: NetworkEnforcement.Always,
        requiresAuth: true,
        requiresConnection: true,
        requiresTabId: true,
      },
    } as any); // Cast to any for test purposes

  const mockNext = jest.fn();

  beforeEach(() => {
    mockNext.mockClear();
  });

  it('leaves unrelated methods to the next middleware', async () => {
    const context = createMockContext([]);
    context.originalRequest.method = 'personal_sign';
    await validate(context, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing checksum validation and invalidParams message', async () => {
    const address = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
    const typedData = {
      types: { Message: [{ name: 'recipients', type: 'address[]' }] },
      domain: { verifyingContract: address },
      message: { recipients: [address] },
    };
    const before = JSON.stringify(typedData);
    await validate(createMockContext([address, typedData]), mockNext);
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(typedData)).toBe(before);

    mockNext.mockClear();
    const invalidChecksum = '0x8Ba1f109551bD432803012645Ac136ddd64DBA72';
    typedData.domain.verifyingContract = invalidChecksum;
    await expect(
      validate(createMockContext([address, typedData]), mockNext)
    ).rejects.toMatchObject({
      code: -32602,
      message: `Invalid address format in domain.verifyingContract: "${invalidChecksum}". Expected hex address starting with 0x`,
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('preserves work-budget errors before approving typed data', async () => {
    const typedData = {
      types: {
        Message: Array.from({ length: 129 }, (_, index) => ({
          name: `field${index}`,
          type: 'string',
        })),
      },
      message: {},
    };
    await expect(
      validate(
        createMockContext(['0xSenderAddress', JSON.stringify(typedData)]),
        mockNext
      )
    ).rejects.toMatchObject({
      code: -32602,
      message:
        'Request exceeds wallet work limits: maximum 128 fields per type',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  describe.each(['eth_signTypedData_v3', 'eth_signTypedData_v4'])(
    '%s payload shape',
    (method) => {
      const address = '0x1111111111111111111111111111111111111111';

      it.each(
        [
          'not-json',
          '',
          '   ',
          '{',
          ' \n {',
          'null',
          'true',
          '42',
          '"plain string"',
          '[]',
          ' \n []',
          null,
          undefined,
          false,
          42,
          [],
        ].flatMap((payload) => [
          { payload, reversed: false },
          { payload, reversed: true },
        ])
      )(
        'rejects $payload without calling next (reversed: $reversed)',
        async ({ payload, reversed }) => {
          const context = createMockContext(
            reversed ? [payload, address] : [address, payload]
          );
          context.originalRequest.method = method;
          await expect(validate(context, mockNext)).rejects.toMatchObject({
            code: -32602,
          });
          expect(mockNext).not.toHaveBeenCalled();
        }
      );

      it.each([
        { json: false, reversed: false },
        { json: false, reversed: true },
        { json: true, reversed: false },
        { json: true, reversed: true },
      ])(
        'accepts valid objects, including whitespace JSON ($json, $reversed)',
        async ({ json, reversed }) => {
          const typedData = {
            types: { Message: [{ name: 'contents', type: 'string' }] },
            primaryType: 'Message',
            domain: {},
            message: { contents: 'Hello' },
          };
          const payload = json ? ` \n ${JSON.stringify(typedData)}` : typedData;
          const context = createMockContext(
            reversed ? [payload, address] : [address, payload]
          );
          context.originalRequest.method = method;
          await validate(context, mockNext);
          expect(mockNext).toHaveBeenCalledTimes(1);
        }
      );
    }
  );

  it.each([
    { json: false, reversed: false },
    { json: false, reversed: true },
    { json: true, reversed: false },
    { json: true, reversed: true },
  ])('preserves V1 arrays ($json, $reversed)', async ({ json, reversed }) => {
    const fields = [{ name: 'Message', type: 'string', value: 'Hello' }];
    const payload = json ? ` \n ${JSON.stringify(fields)}` : fields;
    const address = '0x1111111111111111111111111111111111111111';
    const context = createMockContext(
      reversed ? [payload, address] : [address, payload]
    );
    context.originalRequest.method = 'eth_signTypedData';
    await validate(context, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  describe('Security vulnerabilities that are now caught', () => {
    it('should reject typed data with non-existent primaryType', async () => {
      const maliciousTypedData = {
        primaryType: 'NonExistentType', // This type doesn't exist in types
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
          ],
          Transfer: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
        },
        message: {
          from: '0x1234567890123456789012345678901234567890',
          to: '0x0987654321098765432109876543210987654321',
          amount: '1000000000000000000',
        },
      };

      const context = createMockContext([
        '0xSenderAddress',
        maliciousTypedData,
      ]);

      await expect(validate(context, mockNext)).rejects.toThrow(
        'primaryType "NonExistentType" is not defined in types'
      );
    });

    it('should reject typed data with missing required fields', async () => {
      const incompleteTypedData = {
        primaryType: 'Transfer',
        types: {
          Transfer: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
        },
        message: {
          from: '0x1234567890123456789012345678901234567890',
          // 'to' field is missing - should be caught
          // 'amount' field is missing - should be caught
        },
      };

      const context = createMockContext([
        '0xSenderAddress',
        incompleteTypedData,
      ]);

      await expect(validate(context, mockNext)).rejects.toThrow(
        'Required field "to" is missing from message'
      );
    });

    it('should reject typed data without primaryType when no root type can be determined', async () => {
      const circularTypedData = {
        // No primaryType specified
        types: {
          EIP712Domain: [{ name: 'name', type: 'string' }],
          TypeA: [{ name: 'b', type: 'TypeB' }],
          TypeB: [
            { name: 'a', type: 'TypeA' }, // Circular reference
          ],
        },
        message: {
          // Empty message - middleware will determine TypeA as root type
          // (first non-domain type) and then validate its required fields
        },
      };

      const context = createMockContext(['0xSenderAddress', circularTypedData]);

      // The validation will find TypeA as the root type and then
      // detect that required field "b" is missing from the message
      await expect(validate(context, mockNext)).rejects.toThrow(
        'Required field "b" is missing from message'
      );
    });

    it('should reject arrays that are not actually arrays', async () => {
      const invalidArrayData = {
        primaryType: 'BatchTransfer',
        types: {
          BatchTransfer: [
            { name: 'recipients', type: 'address[]' },
            { name: 'amounts', type: 'uint256[]' },
          ],
        },
        message: {
          recipients: '0x1234567890123456789012345678901234567890', // Should be array
          amounts: [1000, 2000, 3000],
        },
      };

      const context = createMockContext(['0xSenderAddress', invalidArrayData]);

      await expect(validate(context, mockNext)).rejects.toThrow(
        'Field "recipients" must be an array'
      );
    });

    it('should validate nested struct arrays properly', async () => {
      const nestedStructData = {
        primaryType: 'Order',
        types: {
          Order: [{ name: 'items', type: 'Item[]' }],
          Item: [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
        },
        message: {
          items: [
            {
              token: '0x1234567890123456789012345678901234567890',
              amount: '100',
            },
            { token: 'invalid-address', amount: '200' }, // Invalid address in nested struct
          ],
        },
      };

      const context = createMockContext(['0xSenderAddress', nestedStructData]);

      await expect(validate(context, mockNext)).rejects.toThrow(
        'Invalid address format in message.token'
      );
    });

    it('should reject when types object is missing', async () => {
      const noTypesData = {
        primaryType: 'Transfer',
        // types is missing
        message: {
          from: '0x1234567890123456789012345678901234567890',
          to: '0x0987654321098765432109876543210987654321',
        },
      };

      const context = createMockContext(['0xSenderAddress', noTypesData]);

      await expect(validate(context, mockNext)).rejects.toThrow(
        '"types" must be an object'
      );
    });
  });

  describe('Valid typed data should pass', () => {
    it('should accept v1 format (array of typed values)', async () => {
      const v1TypedData = [
        { type: 'string', name: 'Message', value: 'Hi, Alice!' },
        { type: 'uint32', name: 'A number', value: '1337' },
      ];

      const context = createMockContext(['0xSenderAddress', v1TypedData]);
      context.originalRequest.method = 'eth_signTypedData'; // v1 method

      await validate(context, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should validate address fields in v1 format', async () => {
      mockNext.mockClear(); // Clear previous calls
      const v1TypedDataWithAddress = [
        { type: 'string', name: 'Message', value: 'Hi, Alice!' },
        { type: 'address', name: 'Recipient', value: 'invalid-address' },
      ];

      const context = createMockContext([
        '0xSenderAddress',
        v1TypedDataWithAddress,
      ]);
      context.originalRequest.method = 'eth_signTypedData'; // v1 method

      await expect(validate(context, mockNext)).rejects.toThrow(
        'Invalid address format: invalid-address'
      );
    });

    it('should accept valid typed data with proper structure', async () => {
      const validTypedData = {
        primaryType: 'Transfer',
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
          ],
          Transfer: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
        },
        domain: {
          name: 'Test Token',
          version: '1',
        },
        message: {
          from: '0x1234567890123456789012345678901234567890',
          to: '0x0987654321098765432109876543210987654321',
          amount: '1000000000000000000',
        },
      };

      const context = createMockContext(['0xSenderAddress', validTypedData]);

      await validate(context, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });
});
