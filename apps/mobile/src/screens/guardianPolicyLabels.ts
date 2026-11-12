export function guardianDelayLabel(seconds: number, t: (key: string, options?: { count: number }) => string): string {
  if (seconds % 86400 === 0)
    return t(seconds === 86400 ? 'mobile.recoveryDevices.common.day' : 'mobile.recoveryDevices.common.days', { count: seconds / 86400 });
  return t('mobile.recoveryDevices.common.minutes', { count: seconds / 60 });
}
