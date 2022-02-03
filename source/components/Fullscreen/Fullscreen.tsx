import { useBrowser } from 'hooks/useBrowser';
import React from 'react';

import { Icon } from '..';

export const Fullscreen = () => {
  const { browser } = useBrowser();

  const url = browser.runtime.getURL('app.html');

  return url ? (
    <div
      className="fixed bottom-0 left-0 flex gap-2 items-center justify-center p-4 w-full text-brand-white text-sm bg-bkg-4 cursor-pointer sm:hidden"
      onClick={() => window.open(url)}
    >
      <Icon name="desktop" className="mb-1 text-brand-white" />

      <p>Go to fullscreen</p>
    </div>
  ) : null;
};
