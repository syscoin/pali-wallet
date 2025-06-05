import { createTemporaryAlarm } from './alarmUtils';

// Mock Chrome APIs
const mockChromeAlarms = {
  create: jest.fn(),
  clear: jest.fn(),
  onAlarm: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
  },
};

// Mock chrome global
(global as any).chrome = {
  alarms: mockChromeAlarms,
};

// Mock console methods
const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
  // Empty implementation to suppress console output in tests
});

describe('alarmUtils integration tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy.mockClear();
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  describe('Transaction update pattern (Send/Confirm.tsx)', () => {
    it('should handle transaction update alarms correctly', () => {
      // Mock controller emitter like in Send/Confirm.tsx
      const controllerEmitter = jest.fn();

      // Create alarm like in transaction completion
      const alarmName = createTemporaryAlarm({
        delayInSeconds: 4, // 4 seconds for transaction updates
        callback: () => controllerEmitter(['callGetLatestUpdateForAccount']),
      });

      // Verify alarm setup
      expect(mockChromeAlarms.create).toHaveBeenCalledWith(alarmName, {
        delayInMinutes: 4 / 60,
      });

      // Simulate alarm trigger
      const alarmHandler =
        mockChromeAlarms.onAlarm.addListener.mock.calls[0][0];
      alarmHandler({ name: alarmName });

      // Verify controller emitter was called correctly
      expect(controllerEmitter).toHaveBeenCalledTimes(1);
      expect(controllerEmitter).toHaveBeenCalledWith([
        'callGetLatestUpdateForAccount',
      ]);

      // Verify cleanup
      expect(mockChromeAlarms.onAlarm.removeListener).toHaveBeenCalledTimes(1);
      expect(mockChromeAlarms.clear).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple transaction alarms independently', () => {
      const controllerEmitter = jest.fn();

      // Create multiple transaction alarms (like multiple transactions)
      const alarm1 = createTemporaryAlarm({
        delayInSeconds: 4,
        callback: () => controllerEmitter(['callGetLatestUpdateForAccount']),
      });

      const alarm2 = createTemporaryAlarm({
        delayInSeconds: 4,
        callback: () => controllerEmitter(['callGetLatestUpdateForAccount']),
      });

      // Should create unique names
      expect(alarm1).not.toEqual(alarm2);

      // Should register two listeners
      expect(mockChromeAlarms.onAlarm.addListener).toHaveBeenCalledTimes(2);

      // Should create two alarms
      expect(mockChromeAlarms.create).toHaveBeenCalledTimes(2);

      // Get handlers
      const handler1 = mockChromeAlarms.onAlarm.addListener.mock.calls[0][0];
      const handler2 = mockChromeAlarms.onAlarm.addListener.mock.calls[1][0];

      // Trigger first alarm
      handler1({ name: alarm1 });
      expect(controllerEmitter).toHaveBeenCalledTimes(1);

      // Trigger second alarm
      handler2({ name: alarm2 });
      expect(controllerEmitter).toHaveBeenCalledTimes(2);

      // Each should clean up independently
      expect(mockChromeAlarms.onAlarm.removeListener).toHaveBeenCalledTimes(2);
      expect(mockChromeAlarms.clear).toHaveBeenCalledTimes(2);
    });
  });

  describe('Faucet update pattern (useFaucetComponentStates.ts)', () => {
    it('should handle faucet update alarms correctly', () => {
      const controllerEmitter = jest.fn();

      // Create alarm like in faucet success
      const alarmName = createTemporaryAlarm({
        delayInSeconds: 10, // 10 seconds for faucet updates
        callback: () => controllerEmitter(['callGetLatestUpdateForAccount']),
        onError: (error) =>
          console.warn(
            'Failed to update balance after faucet transaction:',
            error
          ),
      });

      // Verify alarm setup
      expect(mockChromeAlarms.create).toHaveBeenCalledWith(alarmName, {
        delayInMinutes: 10 / 60,
      });

      // Simulate alarm trigger
      const alarmHandler =
        mockChromeAlarms.onAlarm.addListener.mock.calls[0][0];
      alarmHandler({ name: alarmName });

      // Verify controller emitter was called correctly
      expect(controllerEmitter).toHaveBeenCalledTimes(1);
      expect(controllerEmitter).toHaveBeenCalledWith([
        'callGetLatestUpdateForAccount',
      ]);

      // Verify cleanup
      expect(mockChromeAlarms.onAlarm.removeListener).toHaveBeenCalledTimes(1);
      expect(mockChromeAlarms.clear).toHaveBeenCalledTimes(1);
    });

    it('should handle faucet update errors correctly', () => {
      const controllerEmitter = jest.fn().mockImplementation(() => {
        throw new Error('Controller error');
      });

      const errorCallback = jest.fn();

      // Create alarm with error handling
      const alarmName = createTemporaryAlarm({
        delayInSeconds: 10,
        callback: () => controllerEmitter(['callGetLatestUpdateForAccount']),
        onError: errorCallback,
      });

      // Trigger alarm
      const alarmHandler =
        mockChromeAlarms.onAlarm.addListener.mock.calls[0][0];
      alarmHandler({ name: alarmName });

      // Should call error handler
      expect(errorCallback).toHaveBeenCalledTimes(1);
      expect(errorCallback).toHaveBeenCalledWith(expect.any(Error));

      // Should still clean up
      expect(mockChromeAlarms.onAlarm.removeListener).toHaveBeenCalledTimes(1);
      expect(mockChromeAlarms.clear).toHaveBeenCalledTimes(1);
    });
  });

  describe('Loading timeout pattern (ActivityPanel.tsx)', () => {
    it('should handle loading timeout alarms correctly', () => {
      const setInternalLoading = jest.fn();
      const TIMEOUT_SECONDS = 10;

      // Create alarm like in ActivityPanel loading timeout
      const alarmName = createTemporaryAlarm({
        delayInSeconds: TIMEOUT_SECONDS,
        callback: () => {
          setInternalLoading(false);
          console.warn('Loading timeout reached for transactions');
        },
        onError: (error) => {
          // Ensure loading state is reset even if callback fails
          setInternalLoading(false);
          console.error('Loading timeout alarm callback failed:', error);
        },
      });

      // Verify alarm setup
      expect(mockChromeAlarms.create).toHaveBeenCalledWith(alarmName, {
        delayInMinutes: TIMEOUT_SECONDS / 60,
      });

      // Simulate timeout
      const alarmHandler =
        mockChromeAlarms.onAlarm.addListener.mock.calls[0][0];
      alarmHandler({ name: alarmName });

      // Verify timeout callback was executed
      expect(setInternalLoading).toHaveBeenCalledTimes(1);
      expect(setInternalLoading).toHaveBeenCalledWith(false);

      // Verify warning was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        'Loading timeout reached for transactions'
      );

      // Verify cleanup
      expect(mockChromeAlarms.onAlarm.removeListener).toHaveBeenCalledTimes(1);
      expect(mockChromeAlarms.clear).toHaveBeenCalledTimes(1);
    });

    it('should handle loading timeout errors correctly', () => {
      const setInternalLoading = jest.fn();
      const mockError = new Error('setInternalLoading failed');

      // Mock setInternalLoading to throw on first call (normal callback)
      setInternalLoading.mockImplementationOnce(() => {
        throw mockError;
      });

      const TIMEOUT_SECONDS = 10;
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {
          // Empty implementation to suppress console output in tests
        });

      // Create alarm with error handling like in ActivityPanel
      const alarmName = createTemporaryAlarm({
        delayInSeconds: TIMEOUT_SECONDS,
        callback: () => {
          setInternalLoading(false);
          console.warn('Loading timeout reached for transactions');
        },
        onError: (error) => {
          // Ensure loading state is reset even if callback fails
          setInternalLoading(false);
          console.error('Loading timeout alarm callback failed:', error);
        },
      });

      // Trigger alarm
      const alarmHandler =
        mockChromeAlarms.onAlarm.addListener.mock.calls[0][0];
      alarmHandler({ name: alarmName });

      // First call should fail and trigger onError
      expect(setInternalLoading).toHaveBeenCalledTimes(2); // Once in callback (fails), once in onError (succeeds)
      expect(setInternalLoading).toHaveBeenNthCalledWith(1, false); // Callback call (throws)
      expect(setInternalLoading).toHaveBeenNthCalledWith(2, false); // Error handler call (succeeds)

      // Should log error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Loading timeout alarm callback failed:',
        mockError
      );

      // Should still clean up
      expect(mockChromeAlarms.onAlarm.removeListener).toHaveBeenCalledTimes(1);
      expect(mockChromeAlarms.clear).toHaveBeenCalledTimes(1);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Real-world usage patterns', () => {
    it('should support all delay patterns used in the codebase', () => {
      const delays = [
        { name: 'transaction-update', seconds: 4 },
        { name: 'faucet-update', seconds: 10 },
        { name: 'loading-timeout', seconds: 10 },
        { name: 'custom-short', seconds: 1 },
        { name: 'custom-long', seconds: 30 },
      ];

      delays.forEach(({ name, seconds }) => {
        mockChromeAlarms.create.mockClear();

        const alarmName = createTemporaryAlarm({
          delayInSeconds: seconds,
          callback: () => console.log(`${name} triggered`),
        });

        expect(mockChromeAlarms.create).toHaveBeenCalledWith(alarmName, {
          delayInMinutes: seconds / 60,
        });
      });
    });

    it('should handle rapid alarm creation without conflicts', () => {
      const alarms = [];
      const callbacks = [];

      // Create multiple alarms rapidly (like multiple quick transactions)
      for (let i = 0; i < 5; i++) {
        const callback = jest.fn();
        callbacks.push(callback);

        const alarmName = createTemporaryAlarm({
          delayInSeconds: 4,
          callback,
        });

        alarms.push(alarmName);
      }

      // All alarms should have unique names
      const uniqueNames = new Set(alarms);
      expect(uniqueNames.size).toBe(5);

      // Should register 5 listeners
      expect(mockChromeAlarms.onAlarm.addListener).toHaveBeenCalledTimes(5);

      // Should create 5 alarms
      expect(mockChromeAlarms.create).toHaveBeenCalledTimes(5);

      // Each alarm should work independently
      for (let i = 0; i < 5; i++) {
        const handler = mockChromeAlarms.onAlarm.addListener.mock.calls[i][0];
        handler({ name: alarms[i] });

        expect(callbacks[i]).toHaveBeenCalledTimes(1);
      }

      // All should clean up
      expect(mockChromeAlarms.onAlarm.removeListener).toHaveBeenCalledTimes(5);
      expect(mockChromeAlarms.clear).toHaveBeenCalledTimes(5);
    });
  });
});
