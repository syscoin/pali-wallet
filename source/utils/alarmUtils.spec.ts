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
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {
  // Empty implementation to suppress console output in tests
});

// Mock setTimeout
const originalSetTimeout = global.setTimeout;
let mockSetTimeout: jest.Mock;

describe('alarmUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy.mockClear();
    consoleLogSpy.mockClear();
    // Reset setTimeout mock
    mockSetTimeout = jest.fn().mockImplementation(
      () =>
        // Return a fake timer ID
        123 as any
    );
    global.setTimeout = mockSetTimeout as any;
  });

  afterAll(() => {
    consoleSpy.mockRestore();
    consoleLogSpy.mockRestore();
    global.setTimeout = originalSetTimeout;
  });

  describe('createTemporaryAlarm', () => {
    it('should use setTimeout for delays under 30 seconds', () => {
      const callback = jest.fn();
      const options: ITemporaryAlarmOptions = {
        delayInSeconds: 10,
        callback,
      };

      const alarmName = createTemporaryAlarm(options);

      // Should generate a unique alarm name
      expect(alarmName).toMatch(/^temp-alarm-\d+-[a-z0-9]+$/);

      // Should NOT use Chrome alarms for < 30 seconds
      expect(mockChromeAlarms.onAlarm.addListener).not.toHaveBeenCalled();
      expect(mockChromeAlarms.create).not.toHaveBeenCalled();

      // Should use setTimeout instead
      expect(mockSetTimeout).toHaveBeenCalledTimes(1);
      expect(mockSetTimeout).toHaveBeenCalledWith(expect.any(Function), 10000);

      // Should log the setTimeout usage
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Using setTimeout for 10s delay (< 30s minimum for Chrome alarms)'
      );
    });

    it('should use Chrome alarms for delays of 30 seconds or more', () => {
      const callback = jest.fn();
      const options: ITemporaryAlarmOptions = {
        delayInSeconds: 30,
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
        delayInMinutes: 30 / 60, // 30 seconds = 0.5 minutes
      });

      // Should NOT use setTimeout
      expect(mockSetTimeout).not.toHaveBeenCalled();

      // Should log the Chrome alarm usage
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Using Chrome alarm for 30s delay'
      );
    });

    it('should execute callback when setTimeout triggers', () => {
      const callback = jest.fn();
      const options: ITemporaryAlarmOptions = {
        delayInSeconds: 5,
        callback,
      };

      createTemporaryAlarm(options);

      // Get the setTimeout callback
      const timeoutCallback = mockSetTimeout.mock.calls[0][0] as () => void;

      // Execute the timeout callback
      timeoutCallback();

      // Should execute callback
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should execute callback when Chrome alarm triggers', () => {
      const callback = jest.fn();
      const options: ITemporaryAlarmOptions = {
        delayInSeconds: 60, // >= 30 seconds to use Chrome alarms
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
      expect(mockChromeAlarms.clear).toHaveBeenCalledWith(alarmName);
    });

    it('should not execute callback for non-matching alarm names', () => {
      const callback = jest.fn();
      const options: ITemporaryAlarmOptions = {
        delayInSeconds: 60, // >= 30 seconds to use Chrome alarms
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

    it('should handle setTimeout callback errors gracefully', () => {
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

      // Get the setTimeout callback
      const timeoutCallback = mockSetTimeout.mock.calls[0][0] as () => void;

      // Execute the timeout callback
      timeoutCallback();

      // Should still try to execute callback
      expect(callback).toHaveBeenCalledTimes(1);

      // Should log warning
      expect(consoleSpy).toHaveBeenCalledWith(
        `Temporary timeout ${alarmName} callback failed:`,
        callbackError
      );

      // Should call error handler
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(callbackError);
    });

    it('should handle Chrome alarm callback errors gracefully', () => {
      const callbackError = new Error('Callback failed');
      const callback = jest.fn().mockImplementation(() => {
        throw callbackError;
      });
      const onError = jest.fn();
      const options: ITemporaryAlarmOptions = {
        delayInSeconds: 60, // >= 30 seconds to use Chrome alarms
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

    it('should handle setTimeout callback errors without onError handler', () => {
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

      // Get the setTimeout callback
      const timeoutCallback = mockSetTimeout.mock.calls[0][0] as () => void;

      // Should not throw error even when callback fails
      expect(() => timeoutCallback()).not.toThrow();

      // Should log warning
      expect(consoleSpy).toHaveBeenCalledWith(
        `Temporary timeout ${alarmName} callback failed:`,
        callbackError
      );
    });

    it('should handle Chrome alarm callback errors without onError handler', () => {
      const callbackError = new Error('Callback failed');
      const callback = jest.fn().mockImplementation(() => {
        throw callbackError;
      });
      const options: ITemporaryAlarmOptions = {
        delayInSeconds: 60, // >= 30 seconds to use Chrome alarms
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

    it('should convert seconds to minutes correctly for Chrome alarms', () => {
      const testCases = [
        { seconds: 30, expectedMinutes: 30 / 60 }, // Minimum for Chrome alarms
        { seconds: 60, expectedMinutes: 1 }, // 1 minute
        { seconds: 120, expectedMinutes: 2 }, // 2 minutes
        { seconds: 300, expectedMinutes: 5 }, // 5 minutes
      ];

      testCases.forEach(({ seconds, expectedMinutes }) => {
        mockChromeAlarms.create.mockClear();
        mockSetTimeout.mockClear();

        const alarmName = createTemporaryAlarm({
          delayInSeconds: seconds,
          callback: jest.fn(),
        });

        // Should use Chrome alarms for >= 30 seconds
        expect(mockChromeAlarms.create).toHaveBeenCalledWith(alarmName, {
          delayInMinutes: expectedMinutes,
        });
        expect(mockSetTimeout).not.toHaveBeenCalled();
      });
    });

    it('should use setTimeout for delays under 30 seconds', () => {
      const testCases = [
        { seconds: 1, expectedMs: 1000 },
        { seconds: 4, expectedMs: 4000 }, // Transaction updates
        { seconds: 10, expectedMs: 10000 }, // Faucet updates
        { seconds: 29, expectedMs: 29000 }, // Just under 30 seconds
      ];

      testCases.forEach(({ seconds, expectedMs }) => {
        mockChromeAlarms.create.mockClear();
        mockSetTimeout.mockClear();

        createTemporaryAlarm({
          delayInSeconds: seconds,
          callback: jest.fn(),
        });

        // Should use setTimeout for < 30 seconds
        expect(mockSetTimeout).toHaveBeenCalledWith(
          expect.any(Function),
          expectedMs
        );
        expect(mockChromeAlarms.create).not.toHaveBeenCalled();
      });
    });

    it('should handle Chrome alarm clear callback', () => {
      const callback = jest.fn();
      const alarmName = createTemporaryAlarm({
        delayInSeconds: 60, // >= 30 seconds to use Chrome alarms
        callback,
      });

      // Get the alarm handler and trigger it
      const alarmHandler =
        mockChromeAlarms.onAlarm.addListener.mock.calls[0][0];
      const mockAlarm = { name: alarmName };
      alarmHandler(mockAlarm);

      // Should call chrome.alarms.clear
      expect(mockChromeAlarms.clear).toHaveBeenCalledWith(alarmName);
    });
  });
});
