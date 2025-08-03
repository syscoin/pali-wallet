import { typedDataValidationMiddleware } from '../source/scripts/Background/controllers/message-handler/middleware/typedDataValidationMiddleware';
import {
  MethodHandlerType,
  NetworkPreference,
  NetworkEnforcement,
} from '../source/scripts/Background/controllers/message-handler/types';

describe('TypedData Validation Security Tests', () => {
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

      await expect(
        typedDataValidationMiddleware(context, mockNext)
      ).rejects.toThrow(
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

      await expect(
        typedDataValidationMiddleware(context, mockNext)
      ).rejects.toThrow('Required field "to" is missing from message');
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
      await expect(
        typedDataValidationMiddleware(context, mockNext)
      ).rejects.toThrow('Required field "b" is missing from message');
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

      await expect(
        typedDataValidationMiddleware(context, mockNext)
      ).rejects.toThrow('Field "recipients" must be an array');
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

      await expect(
        typedDataValidationMiddleware(context, mockNext)
      ).rejects.toThrow('Invalid address format in message.token');
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

      await expect(
        typedDataValidationMiddleware(context, mockNext)
      ).rejects.toThrow('"types" must be an object');
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

      await typedDataValidationMiddleware(context, mockNext);

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

      await expect(
        typedDataValidationMiddleware(context, mockNext)
      ).rejects.toThrow('Invalid address format: invalid-address');
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

      await typedDataValidationMiddleware(context, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });
});
