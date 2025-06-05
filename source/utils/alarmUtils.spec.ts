import { createTemporaryAlarm, ITemporaryAlarmOptions } from './alarmUtils';

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

describe('alarmUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy.mockClear();
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  describe('createTemporaryAlarm', () => {
    it('should create an alarm with correct parameters', () => {
      const callback = jest.fn();
      const options: ITemporaryAlarmOptions = {
        delayInSeconds: 10,
        callback,
      };

      const alarmName = createTemporaryAlarm(options);

      // Should generate a unique alarm name
      expect(alarmName).toMatch(/^temp-alarm-\d+-[a-z0-9]+$/);

      // Should add listener first
      expect(mockChromeAlarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
      expect(mockChromeAlarms.onAlarm.addListener).toHaveBeenCalledWith(
        expect.any(Function)
      );

      // Should create alarm with correct delay (converted to minutes)
      expect(mockChromeAlarms.create).toHaveBeenCalledTimes(1);
      expect(mockChromeAlarms.create).toHaveBeenCalledWith(alarmName, {
        delayInMinutes: 10 / 60, // 10 seconds = 0.1667 minutes
      });
    });

    it('should execute callback when alarm triggers', () => {
      const callback = jest.fn();
      const options: ITemporaryAlarmOptions = {
        delayInSeconds: 5,
        callback,
      };

      const alarmName = createTemporaryAlarm(options);

      // Get the alarm handler that was registered
      const alarmHandler =
        mockChromeAlarms.onAlarm.addListener.mock.calls[0][0];

      // Simulate alarm triggering with matching name
      const mockAlarm = { name: alarmName };
      alarmHandler(mockAlarm);

      // Should execute callback
      expect(callback).toHaveBeenCalledTimes(1);

      // Should clean up listener
      expect(mockChromeAlarms.onAlarm.removeListener).toHaveBeenCalledTimes(1);
      expect(mockChromeAlarms.onAlarm.removeListener).toHaveBeenCalledWith(
        alarmHandler
      );

      // Should clear alarm
      expect(mockChromeAlarms.clear).toHaveBeenCalledTimes(1);
      expect(mockChromeAlarms.clear).toHaveBeenCalledWith(
        alarmName,
        expect.any(Function)
      );
    });

    it('should not execute callback for non-matching alarm names', () => {
      const callback = jest.fn();
      const options: ITemporaryAlarmOptions = {
        delayInSeconds: 5,
        callback,
      };

      createTemporaryAlarm(options);

      // Get the alarm handler that was registered
      const alarmHandler =
        mockChromeAlarms.onAlarm.addListener.mock.calls[0][0];

      // Simulate alarm triggering with different name
      const mockAlarm = { name: 'different-alarm-name' };
      alarmHandler(mockAlarm);

      // Should NOT execute callback
      expect(callback).not.toHaveBeenCalled();

      // Should NOT clean up
      expect(mockChromeAlarms.onAlarm.removeListener).not.toHaveBeenCalled();
      expect(mockChromeAlarms.clear).not.toHaveBeenCalled();
    });

    it('should handle callback errors gracefully', () => {
      const callbackError = new Error('Callback failed');
      const callback = jest.fn().mockImplementation(() => {
        throw callbackError;
      });
      const onError = jest.fn();
      const options: ITemporaryAlarmOptions = {
        delayInSeconds: 5,
        callback,
        onError,
      };

      const alarmName = createTemporaryAlarm(options);

      // Get the alarm handler that was registered
      const alarmHandler =
        mockChromeAlarms.onAlarm.addListener.mock.calls[0][0];

      // Simulate alarm triggering
      const mockAlarm = { name: alarmName };
      alarmHandler(mockAlarm);

      // Should still try to execute callback
      expect(callback).toHaveBeenCalledTimes(1);

      // Should log warning
      expect(consoleSpy).toHaveBeenCalledWith(
        `Temporary alarm ${alarmName} callback failed:`,
        callbackError
      );

      // Should call error handler
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(callbackError);

      // Should still clean up even after error
      expect(mockChromeAlarms.onAlarm.removeListener).toHaveBeenCalledTimes(1);
      expect(mockChromeAlarms.clear).toHaveBeenCalledTimes(1);
    });

    it('should handle callback errors without onError handler', () => {
      const callbackError = new Error('Callback failed');
      const callback = jest.fn().mockImplementation(() => {
        throw callbackError;
      });
      const options: ITemporaryAlarmOptions = {
        delayInSeconds: 5,
        callback,
        // No onError handler provided
      };

      const alarmName = createTemporaryAlarm(options);

      // Get the alarm handler that was registered
      const alarmHandler =
        mockChromeAlarms.onAlarm.addListener.mock.calls[0][0];

      // Simulate alarm triggering
      const mockAlarm = { name: alarmName };

      // Should not throw error even when callback fails
      expect(() => alarmHandler(mockAlarm)).not.toThrow();

      // Should log warning
      expect(consoleSpy).toHaveBeenCalledWith(
        `Temporary alarm ${alarmName} callback failed:`,
        callbackError
      );

      // Should still clean up even after error
      expect(mockChromeAlarms.onAlarm.removeListener).toHaveBeenCalledTimes(1);
      expect(mockChromeAlarms.clear).toHaveBeenCalledTimes(1);
    });

    it('should generate unique alarm names for multiple calls', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      const alarmName1 = createTemporaryAlarm({
        delayInSeconds: 5,
        callback: callback1,
      });

      const alarmName2 = createTemporaryAlarm({
        delayInSeconds: 10,
        callback: callback2,
      });

      // Should generate different names
      expect(alarmName1).not.toEqual(alarmName2);

      // Both should match the expected pattern
      expect(alarmName1).toMatch(/^temp-alarm-\d+-[a-z0-9]+$/);
      expect(alarmName2).toMatch(/^temp-alarm-\d+-[a-z0-9]+$/);
    });

    it('should convert seconds to minutes correctly for various delays', () => {
      const testCases = [
        { seconds: 1, expectedMinutes: 1 / 60 },
        { seconds: 4, expectedMinutes: 4 / 60 }, // Transaction updates
        { seconds: 10, expectedMinutes: 10 / 60 }, // Faucet updates
        { seconds: 30, expectedMinutes: 30 / 60 }, // Timeouts
        { seconds: 60, expectedMinutes: 1 }, // 1 minute
      ];

      testCases.forEach(({ seconds, expectedMinutes }) => {
        mockChromeAlarms.create.mockClear();

        const alarmName = createTemporaryAlarm({
          delayInSeconds: seconds,
          callback: jest.fn(),
        });

        expect(mockChromeAlarms.create).toHaveBeenCalledWith(alarmName, {
          delayInMinutes: expectedMinutes,
        });
      });
    });

    it('should handle Chrome alarm clear callback', () => {
      const callback = jest.fn();
      const alarmName = createTemporaryAlarm({
        delayInSeconds: 5,
        callback,
      });

      // Get the alarm handler and trigger it
      const alarmHandler =
        mockChromeAlarms.onAlarm.addListener.mock.calls[0][0];
      const mockAlarm = { name: alarmName };
      alarmHandler(mockAlarm);

      // Should call chrome.alarms.clear with a callback
      expect(mockChromeAlarms.clear).toHaveBeenCalledWith(
        alarmName,
        expect.any(Function)
      );

      // Get the clear callback and ensure it can be called without error
      const clearCallback = mockChromeAlarms.clear.mock.calls[0][1];
      expect(() => clearCallback()).not.toThrow();
    });
  });
});
