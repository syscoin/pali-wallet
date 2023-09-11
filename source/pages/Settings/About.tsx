import React, { FC } from 'react';
import { useTranslation } from 'react-i18next';

import { version } from '../../../package.json';
import {
  Layout,
  Icon,
  SimpleCard,
  IconButton,
  NeutralButton,
} from 'components/index';
import { useUtils } from 'hooks/index';

const AboutView: FC = () => {
  const handleRedirect = (url: string) => {
    window.open(url);
  };
  const { t } = useTranslation();
  const { navigate, useCopyClipboard, alert } = useUtils();
  const [copied, copy] = useCopyClipboard();

  const showSuccessAlert = () => {
    if (copied) {
      alert.removeAll();
      alert.success(t('settings.linkCopied'));
    }
  };

  return (
    <Layout title="INFO & HELP" id="info-help-title">
      <div className="flex flex-col gap-y-4 w-full text-brand-white text-sm">
        <p>Pali Wallet Browser Extension v2.0</p>
        <p>
          {t('settings.version')}: {version}
        </p>

        <p
          className="hover:text-brand-royalblue cursor-pointer transition-all duration-200"
          onClick={() => handleRedirect('https://docs.paliwallet.com/')}
        >
          Pali API
        </p>
      </div>

      <div className="flex flex-col items-center justify-center w-full md:max-w-full">
        <SimpleCard className="mt-4">
          <div className="flex items-center justify-start mb-4 font-poppins text-base font-bold">
            <Icon
              name="message"
              className="mb-1 text-brand-white"
              wrapperClassname="w-6"
            />

            <p className="text-sm">{t('settings.userSupport')}</p>
          </div>

          <p
            id="user-support-btn"
            className="text-brand-white underline text-xs cursor-pointer"
            onClick={() => handleRedirect('https://discord.com/invite/syscoin')}
          >
            {t('settings.clickHereSupport')}
          </p>
          <div className="pt-3 text-brand-white text-xs">
            {t('settings.toAccess')}
            <div className="flex flex-row mt-2">
              <p className="pt-1">https://discord.com/invite/syscoin</p>
              <IconButton
                onClick={() => copy('https://discord.com/invite/syscoin')}
                type="primary"
                shape="circle"
                className="align-center pl-2"
              >
                <Icon name="copy" className="text-xs" id="copy-address-btn" />
              </IconButton>
              <>{copied ? showSuccessAlert() : null}</>
            </div>
          </div>
        </SimpleCard>

        <div className="absolute bottom-12 md:static md:mt-3">
          <NeutralButton type="button" onClick={() => navigate('/home')}>
            {t('buttons.close')}
          </NeutralButton>
        </div>
      </div>
    </Layout>
  );
};

export default AboutView;
