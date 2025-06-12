import React from 'react';

import { LoadingSvg } from '../Icon/Icon';

export const LoadingComponent = ({ opacity = 100 }: { opacity?: number }) => (
  <div
    className="fixed inset-0 flex items-center justify-center bg-brand-blue600 transition-opacity duration-300"
    style={{ zIndex: '50', opacity: opacity / 100 }}
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
