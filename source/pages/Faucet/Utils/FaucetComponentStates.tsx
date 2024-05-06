import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { faucetTxDetailsProps } from '../Types';
import { useUtils } from 'hooks/useUtils';
import { claimFaucet } from 'scripts/Background/controllers/faucetController';
import { FaucetChainIds } from 'scripts/Background/controllers/message-handler/types';
import { RootState } from 'state/store';

import {
  faucetTxRolluxInfo,
  faucetTxRolluxTestnetInfo,
  faucetTxSyscoinNEVMInfo,
  faucetTxSyscoinNEVMTestnetInfo,
} from './NetworksInfos';

export const FaucetComponentStates = () => {
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const { accounts, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );

  const [status, setStatus] = useState(`request`);
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState(``);

  const [errorMessage, setErrorMessage] = useState('');

  const [faucetTxDetailsInfo, setFaucetTxDetailsInfo] = useState(
    {} as faucetTxDetailsProps
  );

  const { navigate } = useUtils();

  const account = {
    img: accounts[activeAccount.type][activeAccount.id]?.xpub,
    label: accounts[activeAccount.type][activeAccount.id]?.label,
    address: accounts[activeAccount.type][activeAccount.id]?.address,
  };

  const faucetRequestDetails = {
    icon: faucetTxDetailsInfo?.icon,
    tokenSymbol: faucetTxDetailsInfo?.token,
    networkName: faucetTxDetailsInfo?.networkName,
    grabText: `Grab ${faucetTxDetailsInfo.token} with our faucet to begin experiencing the ${faucetTxDetailsInfo.networkName} network!`,
    tokenQuantity: `You can get ${faucetTxDetailsInfo.quantity} ${faucetTxDetailsInfo.token} per wallet address every 24h.`,
    smartContract: faucetTxDetailsInfo.smartContract,
  };

  const handleRequestFaucet = async () => {
    setIsLoading(true);
    try {
      const { data: request } = await claimFaucet(
        activeNetwork.chainId,
        account.address
      );
      if (!request?.status) {
        setStatus('error');
        setErrorMessage(request?.message);
      } else {
        setTxHash(request?.hash);
        setStatus(`success`);
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFaucetButton = useCallback(() => {
    if (status === 'request' || status === 'error') {
      return handleRequestFaucet();
    } else if (status === 'success') {
      return navigate('/home');
    } else {
      return;
    }
  }, [status]);

  const faucetButtonLabel = useMemo(() => {
    let buttonName: string;
    if (status === 'request') {
      buttonName = 'Request Now';
    } else if (status === 'success') {
      buttonName = 'Close';
    } else if (status === 'error') {
      buttonName = 'Try again';
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
