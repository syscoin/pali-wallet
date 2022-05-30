import React from 'react';

import { Icon } from '..';

export const Loading = ({ opacity = 60 }: { opacity?: number }) => (
  <div
    className={`opacity-${opacity} relative z-20 flex items-center justify-center w-full min-w-popup h-full min-h-popup bg-bkg-6`}
  >
    <Icon name="loading" className="ml-2 w-4 text-brand-white" />
  </div>
);
