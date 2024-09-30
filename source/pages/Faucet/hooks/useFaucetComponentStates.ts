import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  FaucetChainIds,
  FaucetStatusResponse,
  faucetTxDetailsProps,
} from '../../../types/faucet';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import {
  faucetTxRolluxInfo,
  faucetTxRolluxTestnetInfo,
  faucetTxSyscoinNEVMInfo,
  faucetTxSyscoinNEVMTestnetInfo,
} from 'utils/constants';
import { claimFaucet } from 'utils/faucet';

export const useFaucetComponentStates = () => {
  const { t } = useTranslation();
  const { navigate } = useUtils();

  const {
    accounts,
    activeAccount,
    activeNetwork: { chainId },
  } = useSelector((state: RootState) => state.vault);

  const [status, setStatus] = useState<FaucetStatusResponse>(
    FaucetStatusResponse.REQUEST
  );
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [faucetTxDetailsInfo, setFaucetTxDetailsInfo] =
    useState<faucetTxDetailsProps | null>(null);

  const account = {
    xpub: accounts[activeAccount.type]?.[activeAccount.id]?.xpub,
    label: accounts[activeAccount.type]?.[activeAccount.id]?.label,
    address: accounts[activeAccount.type]?.[activeAccount.id]?.address,
  };

  const faucetRequestDetails = useMemo(
    () => ({
      icon: faucetTxDetailsInfo?.icon,
      tokenSymbol: faucetTxDetailsInfo?.token,
      networkName: faucetTxDetailsInfo?.networkName,
      grabText: t('faucet.withOurFaucet', {
        token: faucetTxDetailsInfo?.token,
        networkName: faucetTxDetailsInfo?.networkName,
      }),
      tokenQuantity: t('faucet.youCanGet', {
        quantity: faucetTxDetailsInfo?.quantity,
        token: faucetTxDetailsInfo?.token,
      }),
      smartContract: faucetTxDetailsInfo?.smartContract,
    }),
    [faucetTxDetailsInfo]
  );

  const handleRequestFaucet = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await claimFaucet(chainId, account.address);
      if (data?.data?.status) {
        setTxHash(data.data.hash);
        setStatus(FaucetStatusResponse.SUCCESS);
      } else {
        throw new Error(
          data?.data?.message || data?.message || 'Unknown error'
        );
      }
    } catch (error: any) {
      setStatus(FaucetStatusResponse.ERROR);
      setErrorMessage(error.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [chainId, account.address]);

  const handleFaucetButton = useCallback(() => {
    if (
      status === FaucetStatusResponse.REQUEST ||
      status === FaucetStatusResponse.ERROR
    ) {
      handleRequestFaucet();
    } else if (status === FaucetStatusResponse.SUCCESS) {
      navigate('/home');
    }
  }, [status, handleRequestFaucet, navigate]);

  const faucetButtonLabel = useMemo(() => {
    switch (status) {
      case FaucetStatusResponse.REQUEST:
        return t('faucet.requestNow');
      case FaucetStatusResponse.SUCCESS:
        return t('faucet.Close');
      case FaucetStatusResponse.ERROR:
        return t('faucet.tryAgain');
      default:
        return '';
    }
  }, [status, t]);

  useEffect(() => {
    switch (chainId) {
      case FaucetChainIds.RolluxMainnet:
        setFaucetTxDetailsInfo(faucetTxRolluxInfo);
        break;
      case FaucetChainIds.RolluxTestnet:
        setFaucetTxDetailsInfo(faucetTxRolluxTestnetInfo);
        break;
      case FaucetChainIds.NevmMainnet:
        setFaucetTxDetailsInfo(faucetTxSyscoinNEVMInfo);
        break;
      default:
        setFaucetTxDetailsInfo(faucetTxSyscoinNEVMTestnetInfo);
    }
  }, [chainId]);

  return {
    account,
    status,
    handleFaucetButton,
    faucetButtonLabel,
    isLoading,
    faucetRequestDetails,
    errorMessage,
    txHash,
  };
};
