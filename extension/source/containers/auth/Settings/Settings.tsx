import React, { FC } from 'react';

import * as Views from './views';

interface ISettings {
  accountSettings?: boolean;
  generalSettings?: boolean;
  onClose?: () => void;
  open: boolean;
}

export const Settings: FC<ISettings> = ({
  onClose,
  open,
  generalSettings = true,
  accountSettings = false,
}) => {
  return (
    <div>
      {open && (
        <div className="transition-all duration-300 ease-in-out">
          <div
            onClick={onClose}
            className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-darktransparent"
          />

          <div
            className={
              generalSettings
                ? 'transition-all duration-300 ease-in-out fixed z-10 flex flex-col bg-brand-royalBlue max-w-70 top-3rem right-4 p-6 rounded-3xl'
                : 'transition-all duration-300 ease-in-out fixed z-10 flex flex-col bg-brand-deepPink max-w-70 top-3rem right-4 p-6 rounded-3xl'
            }
          >
            <h2 className="pb-4 text-brand-white border-b border-dashed border-brand-graylight w-full text-center mb-4">
              {generalSettings ? 'GENERAL SETTINGS' : 'ACCOUNT SETTINGS'}
            </h2>

            <Views.MainView
              accountSettings={accountSettings}
              generalSettings={generalSettings}
              onClose={onClose}
            />
          </div>
        </div>
      )}
    </div>
  );
};
