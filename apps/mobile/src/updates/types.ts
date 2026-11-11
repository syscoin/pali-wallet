import type { WalletReleaseSnapshot } from '../../../../source/shared/walletReleaseMonitor';

export type MobileUpdateSnapshot = WalletReleaseSnapshot & Readonly<{
  alertsEnabled: boolean;
  permission: 'unknown' | 'granted' | 'denied';
}>;
export interface MobileUpdateService {
  getSnapshot(): MobileUpdateSnapshot;
  subscribe(listener: () => void): () => void;
  check(force?: boolean): Promise<void>;
  setAlerts(enabled: boolean): Promise<void>;
}
