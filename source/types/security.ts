/**
 * Result from checking an address against the blacklist
 */
export interface IBlacklistCheckResult {
  isBlacklisted: boolean;
  note?: string;
  reason?: string;
  severity: 'low' | 'medium' | 'high' | 'critical'; // Additional info, e.g., when blacklist data is still loading
}

/**
 * Spam Filter Types for PPOM-like protection
 */
export interface ISpamFilterRequest {
  method: string;
  timestamp: number;
}

export interface IDappSpamState {
  blockedUntil?: number;
  host: string;
  // Timestamp when block expires
  lastResetTime: number;
  requests: ISpamFilterRequest[];
  warningShown: boolean;
}

export interface ISpamFilterState {
  config: ISpamFilterConfig;
  dapps: {
    [host: string]: IDappSpamState;
  };
}

export interface ISpamFilterConfig {
  // How long to block after the user chooses to block (default: 60000ms = 1min)
  blockDurationMs: number;
  // Feature flag to enable/disable spam filter
  enabled: boolean;
  // Number of unresolved requests before warning (default: 3)
  requestThreshold: number;
  // Time window to count requests (default: 10000ms = 10s)
  timeWindowMs: number;
}
