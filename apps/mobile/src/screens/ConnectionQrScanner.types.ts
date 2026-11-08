export type ConnectionQrScannerProps = Readonly<{
  onScan(uri: string): void;
  onClose(): void;
}>;
