/**
 * Utility functions for managing Chrome alarms with proper cleanup
 */

export interface ITemporaryAlarmOptions {
  callback: () => void;
  delayInSeconds: number;
  onError?: (error: any) => void;
}

/**
 * Creates a temporary alarm that automatically cleans up after execution.
 * Uses setTimeout for delays < 30 seconds, Chrome alarms for longer delays.
 * This avoids Chrome's 30-second minimum alarm limitation in packed extensions.
 *
 * @param delayInSeconds - Delay before alarm triggers (in seconds)
 * @param callback - Function to execute when alarm triggers
 * @param onError - Optional error handler
 * @returns The alarm/timeout identifier for reference
 */
export const createTemporaryAlarm = ({
  delayInSeconds,
  callback,
  onError,
}: ITemporaryAlarmOptions): string => {
  const identifier = `temp-alarm-${Date.now()}-${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  // Chrome extensions have a 30-second minimum for alarms in packed extensions
  // Use setTimeout for shorter delays to avoid warnings and ensure accurate timing
  if (delayInSeconds < 30) {
    console.log(
      `Using setTimeout for ${delayInSeconds}s delay (< 30s minimum for Chrome alarms)`
    );

    setTimeout(() => {
      try {
        callback();
      } catch (error) {
        console.warn(`Temporary timeout ${identifier} callback failed:`, error);
        if (onError) {
          onError(error);
        }
      }
    }, delayInSeconds * 1000);

    return identifier;
  }

  // Use Chrome alarms for delays >= 30 seconds
  console.log(`Using Chrome alarm for ${delayInSeconds}s delay`);

  const handleAlarm = (alarm: chrome.alarms.Alarm) => {
    if (alarm.name === identifier) {
      try {
        callback();
      } catch (error) {
        console.warn(`Temporary alarm ${identifier} callback failed:`, error);
        if (onError) {
          onError(error);
        }
      } finally {
        // Clean up both listener and alarm
        chrome.alarms.onAlarm.removeListener(handleAlarm);
        chrome.alarms.clear(identifier);
      }
    }
  };

  // Add listener first, then create alarm
  chrome.alarms.onAlarm.addListener(handleAlarm);
  chrome.alarms.create(identifier, { delayInMinutes: delayInSeconds / 60 });

  return identifier;
};
