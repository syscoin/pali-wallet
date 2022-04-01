import React from 'react';
import { Icon } from '..';

export const Loading = ({ opacity = 100 }: { opacity?: number }) => {
  return (
    <div
      className={`opacity-${opacity} fixed z-20 flex items-center justify-center w-full min-w-popup h-full min-h-popup bg-bkg-2`}
    >
      <Icon name="loading" className="ml-2 w-4 text-brand-white" />
    </div>
  );
};
