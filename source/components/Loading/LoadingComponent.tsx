import React from 'react';

export const LoadingComponent = ({ opacity = 100 }: { opacity?: number }) => (
  <div
    className="absolute z-[60] top-[120px] left-0 right-0 bottom-0 flex items-center justify-center bg-brand-blue600"
    style={{
      opacity: opacity / 100,
      height: 'calc(100vh - 120px)',
    }}
  >
    <div className="flex items-center justify-center">
      <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-brand-blue500"></div>
    </div>
  </div>
);
