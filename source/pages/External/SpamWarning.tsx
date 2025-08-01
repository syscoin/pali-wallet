import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { useQueryData } from 'hooks/index';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent } from 'utils/browser';

interface ISpamWarningData {
  host: string;
  requestCount: number;
}

export const SpamWarning: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const popupData = useQueryData() as ISpamWarningData;
  const [timeRemaining, setTimeRemaining] = useState<string>('1 minute');

  const spamConfig = useSelector((state: RootState) => state.spamFilter.config);

  useEffect(() => {
    if (!popupData?.host) {
      console.error('No popup data provided');
      navigate('/home');
    }
  }, [popupData, navigate]);

  useEffect(() => {
    // Calculate time remaining in human-readable format
    if (spamConfig.blockDurationMs) {
      const minutes = Math.floor(spamConfig.blockDurationMs / 60000);
      const seconds = Math.floor((spamConfig.blockDurationMs % 60000) / 1000);
      if (minutes > 0) {
        setTimeRemaining(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
      } else {
        setTimeRemaining(`${seconds} second${seconds !== 1 ? 's' : ''}`);
      }
    }
  }, [spamConfig.blockDurationMs]);

  const handleBlockSite = async () => {
    setIsLoading(true);
    try {
      // Send response to background
      dispatchBackgroundEvent(`spamWarningResponse.${popupData.host}`, {
        action: 'block',
      });

      // Close the popup
      window.close();
    } catch (error) {
      console.error('Failed to block site:', error);
      setIsLoading(false);
    }
  };

  const handleCancel = async () => {
    setIsLoading(true);
    try {
      // Send response to background
      dispatchBackgroundEvent(`spamWarningResponse.${popupData.host}`, {
        action: 'allow',
      });

      // Close the popup
      window.close();
    } catch (error) {
      console.error('Failed to allow site:', error);
      setIsLoading(false);
    }
  };

  if (!popupData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-royalblue"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bkg-1 p-6">
      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
        <div className="space-y-4">
          {/* Warning Icon with Count */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/20 rounded-full flex items-center justify-center">
                <svg
                  className="w-10 h-10 text-orange-600 dark:text-orange-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div className="absolute -top-1 -right-1 bg-orange-600 rounded-full px-2 py-0.5">
                <span className="text-white font-bold text-xs">
                  {popupData.requestCount}
                </span>
              </div>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-xl font-bold text-center text-white">
            {t('spamWarning.title', "We've noticed multiple requests")}
          </h1>

          {/* Site Info */}
          <div className="bg-bkg-2 rounded-lg p-3">
            <div className="flex items-center space-x-3">
              <img
                src={`https://www.google.com/s2/favicons?domain=${popupData.host}&sz=32`}
                alt={popupData.host}
                className="w-6 h-6 rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <p className="text-sm font-medium truncate flex-1 text-white">
                {popupData.host}
              </p>
            </div>
          </div>

          {/* Description and Block Duration Combined */}
          <div className="space-y-2">
            <p className="text-sm text-center text-gray-600 dark:text-gray-300">
              {t(
                'spamWarning.description',
                "If you're being spammed with multiple requests, you can temporarily block the site."
              )}
            </p>

            <p className="text-sm text-center font-medium text-orange-600 dark:text-orange-400">
              {t('spamWarning.blockDuration', 'Block duration: {{duration}}', {
                duration: timeRemaining,
              })}
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="mt-8 space-y-3">
          <button
            onClick={handleBlockSite}
            disabled={isLoading}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            ) : (
              <>
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
                {t('spamWarning.blockTemporarily', 'Block temporarily')}
              </>
            )}
          </button>

          <button
            onClick={handleCancel}
            disabled={isLoading}
            className="w-full bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium py-3 px-4 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
