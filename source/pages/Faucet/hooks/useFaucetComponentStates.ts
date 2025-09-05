import { useCallback, useEffect, useMemo, useReducer } from 'react';
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
import { claimFaucet, getExternalFaucetUrl } from 'utils/faucet';

// Define reducer action types
type FaucetAction =
  | { status: FaucetStatusResponse; type: 'SET_STATUS' }
  | { isLoading: boolean; type: 'SET_LOADING' }
  | { txHash: string; type: 'SET_TX_HASH' }
  | { errorMessage: string; type: 'SET_ERROR' }
  | { faucetTxDetailsInfo: faucetTxDetailsProps | null; type: 'SET_TX_DETAILS' }
  | { txHash: string; type: 'REQUEST_SUCCESS' }
  | { errorMessage: string; type: 'REQUEST_ERROR' };

// Define state type
interface IFaucetState {
  errorMessage: string;
  faucetTxDetailsInfo: faucetTxDetailsProps | null;
  isLoading: boolean;
  status: FaucetStatusResponse;
  txHash: string;
}

// Reducer function
function faucetReducer(
  state: IFaucetState,
  action: FaucetAction
): IFaucetState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, status: action.status };
    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading };
    case 'SET_TX_HASH':
      return { ...state, txHash: action.txHash };
    case 'SET_ERROR':
      return { ...state, errorMessage: action.errorMessage };
    case 'SET_TX_DETAILS':
      return { ...state, faucetTxDetailsInfo: action.faucetTxDetailsInfo };
    case 'REQUEST_SUCCESS':
      return {
        ...state,
        txHash: action.txHash,
        status: FaucetStatusResponse.SUCCESS,
        isLoading: false,
      };
    case 'REQUEST_ERROR':
      return {
        ...state,
        status: FaucetStatusResponse.ERROR,
        errorMessage: action.errorMessage,
        isLoading: false,
      };
    default:
      return state;
  }
}

export const useFaucetComponentStates = () => {
  const { t } = useTranslation();
  const { navigate } = useUtils();
  const { controllerEmitter } = useController();

  const {
    accounts,
    activeAccount,
    activeNetwork: { chainId },
  } = useSelector((state: RootState) => state.vault);

  // Use reducer instead of multiple useState
  const [state, dispatch] = useReducer(faucetReducer, {
    status: FaucetStatusResponse.REQUEST,
    isLoading: false,
    txHash: '',
    errorMessage: '',
    faucetTxDetailsInfo: null,
  });

  const account = {
    xpub: accounts[activeAccount.type]?.[activeAccount.id]?.xpub,
    label: accounts[activeAccount.type]?.[activeAccount.id]?.label,
    address: accounts[activeAccount.type]?.[activeAccount.id]?.address,
  };

  const faucetRequestDetails = useMemo(
    () => ({
      tokenSymbol: state.faucetTxDetailsInfo?.token,
      networkName: state.faucetTxDetailsInfo?.networkName,
      grabText: t('faucet.withOurFaucet', {
        token: state.faucetTxDetailsInfo?.token,
        networkName: state.faucetTxDetailsInfo?.networkName,
      }),
      tokenQuantity: t('faucet.youCanGet', {
        quantity: state.faucetTxDetailsInfo?.quantity,
        token: state.faucetTxDetailsInfo?.token,
      }),
      smartContract: state.faucetTxDetailsInfo?.smartContract,
      chainId: state.faucetTxDetailsInfo?.chainId,
    }),
    [state.faucetTxDetailsInfo]
  );

  const handleRequestFaucet = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', isLoading: true });
    try {
      const data = await claimFaucet(chainId, account.address);
      if (data?.data?.status) {
        dispatch({ type: 'REQUEST_SUCCESS', txHash: data.data.hash });

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
      dispatch({
        type: 'REQUEST_ERROR',
        errorMessage: error.message || 'An error occurred',
      });
    }
  }, [chainId, account.address]);

  const handleFaucetButton = useCallback(() => {
    if (state.status === FaucetStatusResponse.REQUEST) {
      handleRequestFaucet();
      return;
    }

    if (state.status === FaucetStatusResponse.ERROR) {
      // Open external faucet hub as provider is unavailable (#714)
      const url = getExternalFaucetUrl();
      try {
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (e) {
        // Fallback: navigate to internal route that can show link if window.open blocked
        navigate('/home');
      }
      return;
    }

    if (state.status === FaucetStatusResponse.SUCCESS) {
      navigate('/home');
    }
  }, [state.status, handleRequestFaucet, navigate]);

  useEffect(() => {
    if (chainId === FaucetChainIds.RolluxMainnet) {
      dispatch({
        type: 'SET_TX_DETAILS',
        faucetTxDetailsInfo: faucetTxRolluxInfo,
      });
    } else if (chainId === FaucetChainIds.RolluxTestnet) {
      dispatch({
        type: 'SET_TX_DETAILS',
        faucetTxDetailsInfo: faucetTxRolluxTestnetInfo,
      });
    } else if (chainId === FaucetChainIds.NevmMainnet) {
      dispatch({
        type: 'SET_TX_DETAILS',
        faucetTxDetailsInfo: faucetTxSyscoinNEVMInfo,
      });
    } else if (chainId === FaucetChainIds.NevmTestnet) {
      dispatch({
        type: 'SET_TX_DETAILS',
        faucetTxDetailsInfo: faucetTxSyscoinNEVMTestnetInfo,
      });
    } else {
      dispatch({ type: 'SET_TX_DETAILS', faucetTxDetailsInfo: null });
    }
  }, [chainId]);

  return {
    account,
    faucetRequestDetails,
    handleFaucetButton,
    handleRequestFaucet,
    ...state, // Spread state to maintain existing API
  };
};
