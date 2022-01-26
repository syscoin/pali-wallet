import { useBrowser } from 'hooks/useBrowser';
import React from 'react';

import { Icon } from '..';

export const Fullscreen = () => {
  const { browser } = useBrowser();

  const url = browser.runtime.getURL('app.html');

  return url ? (
    <div
      className="bg-bkg-4 sm:hidden fixed w-full text-brand-white gap-2 p-4 bottom-0 left-0 text-sm flex justify-center items-center cursor-pointer"
      onClick={() => window.open(url)}
    >
      <Icon name="desktop" className="text-brand-white mb-1" />

      <p>Go to fullscreen</p>
    </div>
  ) : null;
};
