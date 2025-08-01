/**
 * Result from checking an address against the blacklist
 */
export interface IBlacklistCheckResult {
  isBlacklisted: boolean;
  note?: string;
  reason?: string;
  severity: 'low' | 'medium' | 'high' | 'critical'; // Additional info, e.g., when blacklist data is still loading
}
