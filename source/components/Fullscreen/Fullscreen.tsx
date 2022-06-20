import React from 'react';
import { browser } from 'webextension-polyfill-ts';

import { Icon } from '..';

export const Fullscreen: React.FC = () => {
  const url = browser.runtime.getURL('app.html');
  if (!url) return <></>;

  return (
    <div
      className="fixed bottom-0 left-0 flex gap-2 items-center justify-center p-4 w-full text-brand-white text-sm bg-bkg-4 cursor-pointer sm:hidden"
      onClick={() => window.open(url)}
    >
      <Icon name="desktop" className="mb-1 text-brand-white" />

      <p>Fullscreen mode</p>
    </div>
  );
};
