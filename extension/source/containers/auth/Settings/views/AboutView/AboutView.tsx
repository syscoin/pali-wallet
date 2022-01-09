import React, { FC } from 'react';
import { useUtils } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';
import { Icon, SecondaryButton, Card } from 'components/index';

const AboutView: FC = () => {
  const handleRedirect = (url: string) => {
    window.open(url);
  }

  const { history } = useUtils();

  return (
    <AuthViewLayout title="INFO & HELP">
      <div className="text-brand-white text-sm mt-8 w-full pl-8 flex flex-col gap-y-4">
        <p>Pali Wallet Browser Extension v2.0</p>
        <p>Version: 1.0.23</p>

        <p
          className="transition-all duration-200 hover:text-brand-royalblue"
          onClick={() => handleRedirect('https://docs.paliwallet.com/')}>
          Pali API
        </p>
      </div>

      <div className="flex flex-col justify-center items-center w-full">
        <Card
          onClick={() => handleRedirect('https://discord.gg/8QKeyurHRd')}
          className="cursor-pointer"
        >
          <div className="flex justify-start text-base font-bold items-center font-poppins mb-4">
            <Icon name="message" className="text-brand-white mb-1" wrapperClassname="w-6" />

            <p className="text-sm">User support</p>
          </div>

          <p className="text-brand-white text-xs">
            Click here to be redirected to Syscoin Discord, please contact support team at #pali_support.
          </p>
        </Card>

        <div className="absolute bottom-12">
          <SecondaryButton
            type="button"
            onClick={() => history.push('/home')}
          >
            Close
          </SecondaryButton>
        </div>
      </div>
    </AuthViewLayout>
  );
};

export default AboutView;
