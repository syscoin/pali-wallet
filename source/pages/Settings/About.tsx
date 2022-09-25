import React, { FC } from 'react';

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
  const { navigate, useCopyClipboard, alert } = useUtils();
  const [copied, copy] = useCopyClipboard();

  const showSuccessAlert = () => {
    if (copied) {
      alert.removeAll();
      alert.success('Link successfully copied');
    }
  };

  return (
    <Layout title="INFO & HELP" id="info-help-title">
      <div className="flex flex-col gap-y-4 w-full text-brand-white text-sm">
        <p>Pali Wallet Browser Extension v2.0</p>
        <p>Version: {version}</p>

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

            <p className="text-sm">User support</p>
          </div>

          <p
            id="user-support-btn"
            className="text-brand-white underline text-xs cursor-pointer"
            onClick={() =>
              handleRedirect('https://discord.com/invite/8QKeyurHRd')
            }
          >
            Click here to be redirected to Syscoin Discord, please contact
            support team at #pali_support.
          </p>
          <p className="pt-3 text-brand-white text-xs">
            To access the support link, you need to give permission or copy and
            paste the link below
            <div className="flex flex-row mt-2">
              <p className="pt-1">https://discord.com/invite/8QKeyurHRd</p>
              <IconButton
                onClick={() => copy('https://discord.com/invite/8QKeyurHRd')}
                type="primary"
                shape="circle"
                className="align-center pl-2"
              >
                <Icon name="copy" className="text-xs" id="copy-address-btn" />
              </IconButton>
              {copied && showSuccessAlert()}
            </div>
          </p>
        </SimpleCard>

        <div className="absolute bottom-12 md:static md:mt-3">
          <NeutralButton type="button" onClick={() => navigate('/home')}>
            Close
          </NeutralButton>
        </div>
      </div>
    </Layout>
  );
};

export default AboutView;
