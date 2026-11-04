/** Shared policy only: no browser, native, clock or storage authority. */
export const DEFAULT_IDLE_MINUTES = 5;
export type IdleClockSample = Readonly<{ monotonic: number; wall: number }>;
export function idleMinutes(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    (value !== 0 && (value < 5 || value > 120))
  )
    throw new Error('Invalid idle policy');
  return value;
}
export function weakensIdlePolicy(before: number, after: number): boolean {
  idleMinutes(before);
  idleMinutes(after);
  return before !== 0 && (after === 0 || after > before);
}
export function idleSample(value: IdleClockSample): IdleClockSample {
  if (
    !value ||
    !Number.isFinite(value.monotonic) ||
    value.monotonic < 0 ||
    !Number.isFinite(value.wall) ||
    value.wall < 0
  )
    throw new Error('Invalid idle clock');
  return Object.freeze({ monotonic: value.monotonic, wall: value.wall });
}
/** Both clocks are conservative: clock rollback/reset never grants more time. */
export function idleRemaining(
  minutes: number,
  activity: IdleClockSample,
  previous: IdleClockSample,
  now: IdleClockSample
): number {
  idleMinutes(minutes);
  idleSample(activity);
  idleSample(previous);
  idleSample(now);
  if (now.monotonic < previous.monotonic || now.wall < previous.wall) return 0;
  if (minutes === 0) return Infinity;
  return Math.max(
    0,
    minutes * 60000 -
      Math.max(now.monotonic - activity.monotonic, now.wall - activity.wall)
  );
}
