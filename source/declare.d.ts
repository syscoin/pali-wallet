declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.svg' {
  const value: string;
  export default value;
}

declare module '*.xlsx';
declare module '*.xls';
declare module '*.csv';
declare module 'react-notifications-component';

declare const TARGET_BROWSER: 'chrome' | 'firefox' | 'opera' | string;

// eslint-disable-next-line @typescript-eslint/naming-convention
declare interface Window {
  __PALI_OFFSCREEN__?: boolean;
}
