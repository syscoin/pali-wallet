import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from 'components/index';
import { useUtils } from 'hooks/useUtils';

const GetStarted: React.FC = () => {
  const { navigate } = useUtils();
  const { i18n } = useTranslation();
  const { language } = i18n;
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = () => {
    setIsLoading(true);
    navigate('/create-password');
  };

  return (
    <>
      <Button
        id="unlock-btn"
        type="submit"
        onClick={handleClick}
        className="bg-brand-deepPink100 w-[17.5rem] mt-3 h-10 text-white text-base font-base font-medium rounded-2xl"
        loading={isLoading}
      >
        Get started
      </Button>
      <Link
        className={`mt-9 hover:text-brand-graylight text-[#A2A5AB] ${
          language === 'es' ? 'text-xs' : 'text-base'
        } font-light transition-all duration-300 cursor-pointer`}
        to="/import"
        id="import-wallet-link"
      >
        Import using wallet seed phrase
      </Link>
    </>
  );
};

export default GetStarted;
