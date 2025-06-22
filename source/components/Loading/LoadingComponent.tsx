import React from 'react';

import { LoadingSvg } from '../Icon/Icon';

export const LoadingComponent = ({ opacity = 100 }: { opacity?: number }) => (
  <div
    className="absolute flex items-center justify-center bg-brand-blue600"
    style={{
      zIndex: 60,
      opacity: opacity / 100,
      top: '120px', // Below header (80px) + banner (68px)
      left: 0,
      right: 0,
      bottom: 0,
      height: 'calc(100vh - 120px)',
    }}
  >
    <div className="flex flex-col items-center justify-center">
      <LoadingSvg
        className="text-brand-white animate-spin-slow"
        style={{ width: '64px', height: '64px' }}
      />
      <p className="mt-4 text-brand-white text-sm font-light animate-pulse">
        Loading...
      </p>
    </div>
  </div>
);
