import React, { FC, useEffect, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { PALI_INFORMATION } from '../../shared/paliInformation';
import { PaliWhiteSmallIconSvg } from 'components/Icon/Icon';
import {
  Icon,
  SimpleCard,
  IconButton,
  Button,
  PageActionFooter,
} from 'components/index';
import {
  WalletUpdatePanel,
  WalletUpdateSummary,
} from 'components/WalletUpdatePanel';
import { useUtils } from 'hooks/index';
import { navigateBack } from 'utils/navigationState';

// Memoize copy icon to prevent unnecessary re-renders
const CopyIcon = memo(() => (
  <Icon isSvg={true} name="Copy" id="copy-address-btn" />
));
CopyIcon.displayName = 'CopyIcon';

const AboutView: FC = () => {
  const handleRedirect = (url: string) => {
    window.open(url);
  };
  const { t } = useTranslation();
  const { navigate, useCopyClipboard, alert } = useUtils();
  const location = useLocation();
  const [copied, copy] = useCopyClipboard();
  const [showUpdates, setShowUpdates] = useState(false);
  const copySupportUrl = async () => {
    try {
      await copy(PALI_INFORMATION.supportUrl);
    } catch {
      alert.error(t('transactions.copyFailed'));
    }
  };

  useEffect(() => {
    if (copied) {
      alert.info(t('settings.linkCopied'));
    }
  }, [copied, alert, t]);

  if (showUpdates)
    return (
      <>
        <WalletUpdatePanel />
        <PageActionFooter>
          <Button
            className="flex items-center justify-center w-full h-10 bg-white text-brand-blue400 text-base font-medium rounded-[100px]"
            type="button"
            onClick={() => setShowUpdates(false)}
          >
            {t('buttons.back')}
          </Button>
        </PageActionFooter>
      </>
    );

  return (
    <>
      <div className="flex items-center justify-center flex-col w-full text-sm font-normal">
        <PaliWhiteSmallIconSvg className="pb-6 w-16" />
        <p className=" text-white">
          {t('settings.paliWalletBrowserExtension')}
        </p>
        <Button
          type="submit"
          className="bg-transparent border-2 border-white rounded-[100px] w-[150px] h-10 flex items-center justify-center cursor-pointer transition-all duration-200 mt-6 py-2 px-[13px]"
          onClick={() => handleRedirect(PALI_INFORMATION.documentationUrl)}
        >
          Pali API
        </Button>
      </div>

      <div className="flex flex-col items-center justify-center w-full md:max-w-full mt-2">
        <WalletUpdateSummary onOpen={() => setShowUpdates(true)} />
        <SimpleCard>
          <p className="text-xs font-medium text-white mb-[11px]">
            {t('settings.userSupport')}
          </p>

          <a
            id="user-support-btn"
            className="inline-flex text-brand-white text-xs rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue200"
            href={PALI_INFORMATION.supportUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('settings.clickHereSupport')}
          </a>

          <div className="flex items-center">
            <a
              className="min-w-0 break-all text-xs underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue200"
              href={PALI_INFORMATION.supportUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {PALI_INFORMATION.supportUrl}
            </a>
            <IconButton
              aria-label={`${t('buttons.copy')} ${t('settings.userSupport')}`}
              onClick={copySupportUrl}
              type="primary"
              shape="circle"
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded hover:bg-alpha-whiteAlpha100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue200"
            >
              <CopyIcon />
            </IconButton>
          </div>
        </SimpleCard>

        <a
          className="mt-4 text-xs text-brand-gray200 underline hover:text-brand-white"
          href={PALI_INFORMATION.dataProvider.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('settings.tokenDataProvider', {
            provider: PALI_INFORMATION.dataProvider.name,
          })}
        </a>

        <PageActionFooter>
          <Button
            className="flex items-center justify-center w-full h-10 bg-white text-brand-blue400 text-base font-medium rounded-[100px]"
            type="button"
            onClick={() => navigateBack(navigate, location)}
          >
            {t('buttons.close')}
          </Button>
        </PageActionFooter>
      </div>
    </>
  );
};

export default AboutView;
