import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { RootState } from 'state/store';

const THREE_SECONDS = 3000;

export const useNetworkChangeHandler = () => {
  const isNetworkChanging = useSelector(
    (state: RootState) => state.vault.isNetworkChanging
  );
  const navigate = useNavigate();

  useEffect(() => {
    let timeout: NodeJS.Timeout;

    if (isNetworkChanging) {
      timeout = setTimeout(() => {
        navigate('/chain-fail-to-connect');
      }, THREE_SECONDS);
    }

    return () => {
      clearTimeout(timeout);
    };
  }, [isNetworkChanging, navigate]);
};
