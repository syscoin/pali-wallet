import React from 'react';

import { Icon } from '..';

export const Loading = ({
  opacity = 60,
  usePopupSize = true,
}: {
  opacity?: number;
  usePopupSize?: boolean;
}) => (
  <div
    className={`opacity-${opacity} ${
      usePopupSize && 'min-w-popup min-h-popup'
    } relative z-20 flex items-center justify-center w-full bg-transparent`}
  >
    <Icon name="loading" className="text-brand-white animate-spin-slow" />
  </div>
);
