import React, { FC } from 'react';
import { useUtils } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout';

const AboutView: FC = () => {
  const { alert } = useUtils();
  
  const handleSupportClick = () => {
    alert.show('You will be redirected to Syscoin Discord, please contact support team at #pali_support', {
      timeout: 5000,
      type: 'success',
      onClose: () => {
        window.open('https://discord.gg/8QKeyurHRd')
      }
    });

  };
  const handleDocsClick = () => {
    window.open('https://docs.paliwallet.com/');
  };
  return (
    <AuthViewLayout title="INFO & HELP">
      <span>Pali Wallet Chrome Extension v1.0</span>
      <span>Version: 1.0.10</span>
      <span>
        Support:{' '}
        <a
          onClick={handleSupportClick}
        >
          Pali support
        </a>
      </span>
      <span>
        API Docs
        <a
          onClick={handleDocsClick}
        >
          Pali API
        </a>
      </span>
    </AuthViewLayout>
  );
};

export default AboutView;
