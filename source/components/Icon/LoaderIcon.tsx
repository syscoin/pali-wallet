import * as React from 'react';

interface ILoaderIcon {
  className: string;
  style: { color?: string; fontSize?: number };
}

export const LoaderIcon: React.FC<ILoaderIcon> = ({
  style = { color: 'white' },
  className,
}) => (
  <svg
    className={className}
    width="50"
    height="50"
    viewBox="0 0 50 50"
    fill={style.color || 'white'}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M25.0001 2.08301C26.1507 2.08301 27.0834 3.01575 27.0834 4.16634V12.4997C27.0834 13.6503 26.1507 14.583 25.0001 14.583C23.8495 14.583 22.9167 13.6503 22.9167 12.4997V4.16634C22.9167 3.01575 23.8495 2.08301 25.0001 2.08301Z"
      fill={style.color || 'white'}
      fillOpacity="0.85"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M25.0001 35.417C26.1507 35.417 27.0834 36.3497 27.0834 37.5003V45.8337C27.0834 46.9843 26.1507 47.917 25.0001 47.917C23.8495 47.917 22.9167 46.9843 22.9167 45.8337V37.5003C22.9167 36.3497 23.8495 35.417 25.0001 35.417Z"
      fill={style.color || 'white'}
      fillOpacity="0.85"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8.79769 8.79769C9.61129 7.9841 10.9304 7.9841 11.744 8.79769L17.6398 14.6935C18.4534 15.5071 18.4534 16.8262 17.6398 17.6398C16.8262 18.4534 15.5071 18.4534 14.6935 17.6398L8.79769 11.744C7.9841 10.9304 7.9841 9.61129 8.79769 8.79769Z"
      fill={style.color || 'white'}
      fillOpacity="0.85"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M32.3602 32.3602C33.1738 31.5466 34.4929 31.5466 35.3065 32.3602L41.2023 38.256C42.0159 39.0696 42.0159 40.3887 41.2023 41.2023C40.3887 42.0159 39.0696 42.0159 38.256 41.2023L32.3602 35.3065C31.5466 34.4929 31.5466 33.1738 32.3602 32.3602Z"
      fill={style.color || 'white'}
      fillOpacity="0.85"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M2.08325 25.0003C2.08325 23.8497 3.01599 22.917 4.16659 22.917H12.4999C13.6505 22.917 14.5833 23.8497 14.5833 25.0003C14.5833 26.1509 13.6505 27.0837 12.4999 27.0837H4.16659C3.01599 27.0837 2.08325 26.1509 2.08325 25.0003Z"
      fill={style.color || 'white'}
      fillOpacity="0.85"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M35.4167 25.0003C35.4167 23.8497 36.3495 22.917 37.5001 22.917H45.8334C46.984 22.917 47.9167 23.8497 47.9167 25.0003C47.9167 26.1509 46.984 27.0837 45.8334 27.0837H37.5001C36.3495 27.0837 35.4167 26.1509 35.4167 25.0003Z"
      fill={style.color || 'white'}
      fillOpacity="0.85"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M17.6398 32.3602C18.4534 33.1738 18.4534 34.4929 17.6398 35.3065L11.744 41.2023C10.9304 42.0159 9.61129 42.0159 8.79769 41.2023C7.9841 40.3887 7.9841 39.0696 8.79769 38.256L14.6935 32.3602C15.5071 31.5466 16.8262 31.5466 17.6398 32.3602Z"
      fill={style.color || 'white'}
      fillOpacity="0.85"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M41.2023 8.79769C42.0159 9.61129 42.0159 10.9304 41.2023 11.744L35.3065 17.6398C34.4929 18.4534 33.1738 18.4534 32.3602 17.6398C31.5466 16.8262 31.5466 15.5071 32.3602 14.6935L38.256 8.79769C39.0696 7.9841 40.3887 7.9841 41.2023 8.79769Z"
      fill={style.color || 'white'}
      fillOpacity="0.85"
    />
  </svg>
);
