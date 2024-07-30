import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  faucetTxRolluxInfo,
  faucetTxRolluxTestnetInfo,
  faucetTxSyscoinNEVMInfo,
  faucetTxSyscoinNEVMTestnetInfo,
} from '../consts';
import {
  FaucetChainIds,
  FaucetStatusResponse,
  faucetTxDetailsProps,
} from '../Types';
import { useUtils } from 'hooks/useUtils';
import { claimFaucet } from 'scripts/Background/controllers/faucetController';
import { RootState } from 'state/store';

export const FaucetComponentStates = () => {
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const { accounts, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );

  const [status, setStatus] = useState(FaucetStatusResponse.REQUEST);
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [faucetTxDetailsInfo, setFaucetTxDetailsInfo] = useState(
    {} as faucetTxDetailsProps
  );

  const { navigate } = useUtils();
  const { t } = useTranslation();

  const account = {
    img: accounts[activeAccount.type][activeAccount.id]?.xpub,
    label: accounts[activeAccount.type][activeAccount.id]?.label,
    address: accounts[activeAccount.type][activeAccount.id]?.address,
  };

  const faucetRequestDetails = {
    icon: faucetTxDetailsInfo?.icon,
    tokenSymbol: faucetTxDetailsInfo?.token,
    networkName: faucetTxDetailsInfo?.networkName,
    grabText: t('faucet.withOurFaucet', {
      token: faucetTxDetailsInfo.token,
      networkName: faucetTxDetailsInfo.networkName,
    }),
    tokenQuantity: t('faucet.youCanGet', {
      quantity: faucetTxDetailsInfo.quantity,
      token: faucetTxDetailsInfo.token,
    }),
    smartContract: faucetTxDetailsInfo.smartContract,
  };

  const handleRequestFaucet = async () => {
    setIsLoading(true);
    try {
      const data = await claimFaucet(activeNetwork.chainId, account.address);
      if (!data?.status || !data?.data?.status) {
        setStatus(FaucetStatusResponse.ERROR);
        setErrorMessage(
          data?.data?.message ? data?.data?.message : data?.message
        );
      } else {
        setTxHash(data?.data?.hash);
        setStatus(FaucetStatusResponse.SUCCESS);
      }
    } catch (error) {
      setStatus(FaucetStatusResponse.ERROR);
      setErrorMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFaucetButton = useCallback(() => {
    if (
      status === FaucetStatusResponse.REQUEST ||
      status === FaucetStatusResponse.ERROR
    ) {
      return handleRequestFaucet();
    } else if (status === FaucetStatusResponse.SUCCESS) {
      return navigate('/home');
    } else {
      return;
    }
  }, [status]);

  const faucetButtonLabel = useMemo(() => {
    let buttonName: string;
    if (status === FaucetStatusResponse.REQUEST) {
      buttonName = t('faucet.requestNow');
    } else if (status === FaucetStatusResponse.SUCCESS) {
      buttonName = t('faucet.Close');
    } else if (status === FaucetStatusResponse.ERROR) {
      buttonName = t('faucet.tryAgain');
    } else {
      return;
    }
    return buttonName;
  }, [status]);

  useEffect(() => {
    if (activeNetwork.chainId === FaucetChainIds.RolluxMainnet) {
      setFaucetTxDetailsInfo(faucetTxRolluxInfo);
    } else if (activeNetwork.chainId === FaucetChainIds.RolluxTestnet) {
      setFaucetTxDetailsInfo(faucetTxRolluxTestnetInfo);
    } else if (activeNetwork.chainId === FaucetChainIds.nevmMainnet) {
      setFaucetTxDetailsInfo(faucetTxSyscoinNEVMInfo);
    } else {
      setFaucetTxDetailsInfo(faucetTxSyscoinNEVMTestnetInfo);
    }
  }, [activeNetwork]);

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
