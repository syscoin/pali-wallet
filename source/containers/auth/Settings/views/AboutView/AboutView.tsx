import React, { FC } from 'react';
import { useUtils } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';
import { Icon, SecondaryButton, Card } from 'components/index';

const AboutView: FC = () => {
  const handleRedirect = (url: string) => {
    window.open(url);
  };

  const { navigate } = useUtils();

  return (
    <AuthViewLayout title="INFO & HELP" id="info-help-title">
      <div className="flex flex-col gap-y-4 mt-8 pl-8 w-full text-brand-white text-sm">
        <p>Pali Wallet Browser Extension v2.0</p>
        <p>Version: 1.0.23</p>

        <p
          className="hover:text-brand-royalblue transition-all duration-200"
          onClick={() => handleRedirect('https://docs.paliwallet.com/')}
        >
          Pali API
        </p>
      </div>

      <div className="flex flex-col items-center justify-center w-full">
        <Card
          onClick={() => handleRedirect('https://discord.gg/8QKeyurHRd')}
          className="cursor-pointer"
        >
          <div className="flex items-center justify-start mb-4 font-poppins text-base font-bold">
            <Icon
              name="message"
              className="mb-1 text-brand-white"
              wrapperClassname="w-6"
            />

            <p className="text-sm">User support</p>
          </div>

          <p className="text-brand-white text-xs">
            Click here to be redirected to Syscoin Discord, please contact
            support team at #pali_support.
          </p>
        </Card>

        <div className="absolute bottom-12">
          <SecondaryButton type="button" onClick={() => navigate('/home')}>
            Close
          </SecondaryButton>
        </div>
      </div>
    </AuthViewLayout>
  );
};

export default AboutView;
