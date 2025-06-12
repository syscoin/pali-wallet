import React from 'react';

import { LoadingSvg } from '../Icon/Icon';

export const LoadingComponent = ({ opacity = 60 }: { opacity?: number }) => (
  <>
    <div
      className={`relative pt-4 flex flex-col items-center justify-center w-full bg-transparent`}
      style={{ zIndex: '9' }}
    >
      <div className={`flex items-center justify-center opacity-${opacity}`}>
        <LoadingSvg className="text-brand-white animate-spin-slow" />
      </div>
    </div>
  </>
);
