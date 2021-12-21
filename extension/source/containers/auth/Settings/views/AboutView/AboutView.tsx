import React, { FC } from 'react';
import { useUtils } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';
import { Icon, SecondaryButton } from 'components/index';

const AboutView: FC = () => {
  const handleRedirect = (url: string) => {
    window.open(url);
  }

  const { history } = useUtils();

  return (
    <AuthViewLayout title="INFO & HELP">
      <div className="text-brand-white text-sm mx-4 mt-8 flex flex-col gap-y-4 w-full">
        <p>Pali Wallet Browser Extension v2.0</p>
        <p>Version: 1.0.23</p>

        <p
          className="transition-all duration-200 hover:text-brand-royalBlue"
          onClick={() => handleRedirect('https://docs.paliwallet.com/')}>
          Pali API
        </p>
      </div>

      <div className="flex flex-col justify-center items-center w-full">
        <div
          className="bg-brand-navydark border border-dashed border-brand-royalBlue mx-6 my-8 p-4 text-xs rounded-lg cursor-pointer"
          onClick={() => handleRedirect('https://discord.gg/8QKeyurHRd')}
        >
          <div className="flex justify-start text-base font-bold items-center font-poppins mb-4">
            <Icon name="message" className="text-brand-white mb-1" wrapperClassname="w-6" />

            <p className="text-sm">User support</p>
          </div>

          <p className="text-brand-white text-xs">
            Click here to be redirected to Syscoin Discord, please contact support team at #pali_support.
          </p>
        </div>

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
