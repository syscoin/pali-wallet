export type QrScannerCopy = Readonly<{
  title: string; instructions: string; unavailable: string; permission: string;
  invalidTitle: string; invalidBody: string; manualAction: string; webUnavailable: string;
}>;
export type QrScannerProps<T> = Readonly<{
  parse(value: string): T | null;
  copy: QrScannerCopy;
  onScan(value: T): void;
  onClose(): void;
}>;
