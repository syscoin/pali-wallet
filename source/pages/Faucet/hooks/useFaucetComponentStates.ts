import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  FaucetChainIds,
  FaucetStatusResponse,
  faucetTxDetailsProps,
} from '../../../types/faucet';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { createTemporaryAlarm } from 'utils/alarmUtils';
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
  const { controllerEmitter } = useController();

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
      chainId: faucetTxDetailsInfo?.chainId,
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

        // Trigger immediate balance update after successful faucet request
        try {
          controllerEmitter(['callGetLatestUpdateForAccount']);
        } catch (error) {
          console.warn(
            'Failed to trigger immediate update after faucet:',
            error
          );
        }

        // Schedule a single delayed update to catch the balance change once transaction is processed
        // Faucet transactions are often internal and may not appear in transaction lists
        createTemporaryAlarm({
          delayInSeconds: 10,
          callback: () => controllerEmitter(['callGetLatestUpdateForAccount']),
          onError: (error) =>
            console.warn(
              'Failed to update balance after faucet transaction:',
              error
            ),
        });
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
  }, [chainId, account.address, controllerEmitter]);

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
