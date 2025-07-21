import React, { FC, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import packageJson from '../../../package.json';
import { PaliWhiteSmallIconSvg } from 'components/Icon/Icon';
import { Icon, SimpleCard, IconButton, Button } from 'components/index';
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

  useEffect(() => {
    if (copied) {
      alert.info(t('settings.linkCopied'));
    }
  }, [copied, alert, t]);

  return (
    <>
      <div className="flex items-center justify-center flex-col w-full text-sm font-normal">
        <PaliWhiteSmallIconSvg className="pb-6 w-16" />
        <p className=" text-white">Pali Wallet Browser Extension</p>
        <p className="text-brand-gray200">
          {t('settings.version')}: {packageJson.version}
        </p>

        <Button
          type="submit"
          className="bg-transparent border-2 border-white rounded-[100px] w-[150px] h-10 flex items-center justify-center cursor-pointer transition-all duration-200 mt-6 py-2 px-[13px]"
          onClick={() => handleRedirect('https://docs.paliwallet.com/')}
        >
          Pali API
        </Button>
      </div>

      <div className="flex flex-col items-center justify-center w-full md:max-w-full mt-2">
        <SimpleCard>
          <p className="text-xs font-medium text-white mb-[11px]">
            {t('settings.userSupport')}
          </p>

          <p
            id="user-support-btn"
            className="flex flex-nowrap text-brand-white text-xs cursor-pointer"
            onClick={() => handleRedirect('https://discord.com/invite/syscoin')}
          >
            {t('settings.clickHereSupport')}
          </p>

          <div className="flex items-center">
            <p
              className="text-xs underline cursor-pointer"
              onClick={() =>
                handleRedirect('https://discord.com/invite/syscoin')
              }
            >
              https://discord.com/invite/syscoin
            </p>
            <IconButton
              onClick={() => copy('https://discord.com/invite/syscoin')}
              type="primary"
              shape="circle"
              className="align-center pl-2"
            >
              <CopyIcon />
            </IconButton>
          </div>
        </SimpleCard>

        <div className="w-full px-4 absolute bottom-12 md:static">
          <Button
            className="flex items-center justify-center w-full h-10 bg-white text-brand-blue400 text-base font-medium rounded-[100px]"
            type="button"
            onClick={() => navigateBack(navigate, location)}
          >
            {t('buttons.close')}
          </Button>
        </div>
      </div>
    </>
  );
};

export default AboutView;
