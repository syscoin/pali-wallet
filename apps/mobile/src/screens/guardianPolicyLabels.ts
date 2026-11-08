export function guardianDelayLabel(seconds: number): string {
  if (seconds % 86400 === 0)
    return `${seconds / 86400} ${seconds === 86400 ? 'day' : 'days'}`;
  return `${seconds / 60} minutes`;
}
