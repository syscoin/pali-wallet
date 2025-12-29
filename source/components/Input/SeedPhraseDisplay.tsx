import { isEmpty } from 'lodash';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ISeedPhraseDisplayProps {
  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Whether to use the TextArea style (ForgetWallet) or word-by-word style (Phrase)
   */
  displayMode?: 'words' | 'textarea';

  /**
   * Whether the display is enabled/disabled
   */
  isEnabled?: boolean;

  /**
   * Placeholder text when seed phrase is not available
   */
  placeholder?: string;

  /**
   * The actual seed phrase to display
   */
  seedPhrase?: string;

  /**
   * Whether to show the eye toggle for hiding/showing the phrase
   */
  showEyeToggle?: boolean;
}

export const SeedPhraseDisplay: React.FC<ISeedPhraseDisplayProps> = ({
  seedPhrase,
  isEnabled = true,
  showEyeToggle = true,
  placeholder,
  className = '',
  displayMode = 'words',
}) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState<boolean>(false);

  const mockedPhrase =
    '**** ******* ****** ****** ****** ******** *** ***** ****** ***** *****';
  const displayPhrase = isEmpty(seedPhrase)
    ? placeholder || mockedPhrase
    : seedPhrase;

  const toggleVisible = () => {
    setVisible((prev) => !prev);
  };

  if (displayMode === 'textarea') {
    // ForgetWallet style - TextArea (view-only, no copy to prevent clipboard attacks)
    return (
      <div className={`w-full md:max-w-md ${className}`}>
        <div className="relative">
          <textarea
            className={`${
              !isEnabled
                ? 'opacity-50 cursor-not-allowed bg-gray-800'
                : 'opacity-100 bg-fields-input-primary'
            } ${
              showEyeToggle && !visible ? 'filter blur-sm' : ''
            } p-2 pl-4 pr-12 w-full h-[90px] text-brand-graylight text-sm border border-border-default focus:border-fields-input-borderfocus rounded-[10px] outline-none resize-none select-none`}
            placeholder={!isEnabled ? t('settings.enterYourPassword') : ''}
            value={displayPhrase}
            readOnly={true}
          />

          {/* Controls container - eye toggle only (copy removed for security) */}
          <div className="absolute top-2 right-2 flex items-center">
            {/* Eye toggle - only show when showEyeToggle is true and seed is available */}
            {showEyeToggle && seedPhrase && (
              <button
                type="button"
                onClick={toggleVisible}
                className="p-1 rounded hover:bg-gray-700 transition-colors duration-200"
                title={visible ? 'Hide' : 'Show'}
              >
                {visible ? (
                  <img
                    className="w-[18px] max-w-none cursor-pointer hover:cursor-pointer z-20"
                    src="/assets/all_assets/visibleEye.svg"
                    alt="Hide"
                  />
                ) : (
                  <img
                    className="w-[18px] max-w-none cursor-pointer hover:cursor-pointer z-20"
                    src="/assets/all_assets/notVisibleEye.svg"
                    alt="Show"
                  />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Phrase style - Word-by-word (view-only, no copy to prevent clipboard attacks)
  return (
    <div className={`flex flex-col ${className}`}>
      {/* Seed phrase display box */}
      <div className="relative flex gap-3 items-start p-4 w-full max-w-[22rem] border border-border-default rounded-[10px] bg-brand-blue800">
        <div
          className={`flex flex-wrap flex-row gap-2 bg-brand-blue800 flex-1 select-none ${
            visible || !showEyeToggle ? '' : 'filter blur-sm'
          }`}
        >
          {displayPhrase.split(' ').map((phraseText: string, index: number) => (
            <p key={index} className="flex text-white text-sm font-light">
              {phraseText}
            </p>
          ))}
        </div>

        {/* Controls container - eye toggle only (copy removed for security) */}
        <div className="flex items-center bg-brand-blue800">
          {/* Eye toggle - only show when enabled and showEyeToggle is true */}
          {showEyeToggle && seedPhrase && (
            <button
              type="button"
              onClick={toggleVisible}
              className="p-1 rounded hover:bg-gray-700 transition-colors duration-200"
              title={visible ? 'Hide' : 'Show'}
            >
              {visible ? (
                <img
                  className="w-[18px] h-[18px] max-w-none cursor-pointer hover:cursor-pointer z-20"
                  src="/assets/all_assets/visibleEye.svg"
                  alt="Hide"
                />
              ) : (
                <img
                  className="w-[18px] h-[18px] max-w-none cursor-pointer hover:cursor-pointer z-20"
                  src="/assets/all_assets/notVisibleEye.svg"
                  alt="Show"
                />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SeedPhraseDisplay;
