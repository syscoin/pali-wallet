import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useSelector } from 'react-redux';

import { FaucetChainIds, FaucetStatusResponse } from '../../../types/faucet';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import store, { RootState } from 'state/store';
import { INetworkType } from 'types/network';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import {
  faucetTxRolluxInfo,
  faucetTxRolluxTestnetInfo,
  faucetTxSyscoinNEVMInfo,
  faucetTxSyscoinNEVMTestnetInfo,
} from 'utils/constants';
import { claimFaucet, getExternalFaucetUrl } from 'utils/faucet';

const faucetDetails = {
  [FaucetChainIds.RolluxMainnet]: faucetTxRolluxInfo,
  [FaucetChainIds.RolluxTestnet]: faucetTxRolluxTestnetInfo,
  [FaucetChainIds.NevmMainnet]: faucetTxSyscoinNEVMInfo,
  [FaucetChainIds.NevmTestnet]: faucetTxSyscoinNEVMTestnetInfo,
};
const initialState = {
  status: FaucetStatusResponse.REQUEST,
  isLoading: false,
  txHash: '',
  errorMessage: '',
};
const getFaucetContext = ({
  vault,
  vaultGlobal,
}: Pick<RootState, 'vault' | 'vaultGlobal'>) => {
  const { activeAccount, activeNetwork, accounts, isBitcoinBased } = vault;
  const address = accounts[activeAccount.type]?.[activeAccount.id]?.address;
  const changing =
    vaultGlobal.isSwitchingAccount ||
    ['switching', 'connecting'].includes(vaultGlobal.networkStatus);
  return {
    scope: JSON.stringify([
      activeAccount.type,
      activeAccount.id,
      address,
      isBitcoinBased,
      activeNetwork.kind,
      activeNetwork.chainId,
      activeNetwork.url,
      activeNetwork.slip44,
      changing,
    ]),
    eligible:
      !isBitcoinBased &&
      activeNetwork.kind === INetworkType.Ethereum &&
      Boolean(address && faucetDetails[activeNetwork.chainId]),
    ready: !changing,
  };
};

export const useFaucetComponentStates = () => {
  const { t } = useTranslation();
  const { navigate } = useUtils();
  const { controllerEmitter } = useController();
  const vault = useSelector((state: RootState) => state.vault);
  const { scope, eligible, ready } = useSelector(
    getFaucetContext,
    shallowEqual
  );
  const { accounts, activeAccount, activeNetwork } = vault;
  const account = accounts[activeAccount.type]?.[activeAccount.id];
  const details = eligible ? faucetDetails[activeNetwork.chainId] : null;
  const owner = useRef({
    active: true,
    scope,
    revision: 0,
    request: null as object | null,
  });
  const [state, setState] = useState({ ...initialState, revision: 0 });
  // Do not render an old success/error while the scope-change effect catches up.
  if (owner.current.scope !== scope) {
    owner.current.scope = scope;
    owner.current.revision += 1;
    owner.current.request = null;
  }
  const currentState =
    state.revision === owner.current.revision ? state : initialState;

  useEffect(() => {
    owner.current.active = true;
    // Observe departures before React can batch A -> B -> A into one render.
    const unsubscribe = store.subscribe(() => {
      const next = getFaucetContext(store.getState()).scope;
      if (next !== owner.current.scope) {
        owner.current.scope = next;
        owner.current.revision += 1;
        owner.current.request = null;
        setState({ ...initialState, revision: owner.current.revision });
      }
    });
    return () => {
      unsubscribe();
      owner.current.active = false;
      owner.current.request = null;
    };
  }, []);

  useEffect(() => {
    if (ready && !eligible) navigate('/home', { replace: true });
  }, [eligible, ready, navigate]);

  const faucetRequestDetails = useMemo(
    () => ({
      tokenSymbol: details?.token,
      networkName: details?.networkName,
      grabText: t('faucet.withOurFaucet', {
        token: details?.token,
        networkName: details?.networkName,
      }),
      tokenQuantity: t('faucet.youCanGet', {
        quantity: details?.quantity,
        token: details?.token,
      }),
      smartContract: details?.smartContract,
      chainId: details?.chainId,
    }),
    [details, t]
  );

  const handleRequestFaucet = useCallback(async () => {
    const live = getFaucetContext(store.getState());
    if (
      !owner.current.active ||
      owner.current.request ||
      !live.eligible ||
      !live.ready ||
      live.scope !== scope
    )
      return;
    const request = {};
    const revision = owner.current.revision;
    owner.current.request = request;
    const isCurrent = () =>
      owner.current.active &&
      owner.current.request === request &&
      owner.current.scope === scope &&
      getFaucetContext(store.getState()).scope === scope;
    setState({ ...initialState, revision, isLoading: true });
    try {
      const data = await claimFaucet(activeNetwork.chainId, account.address);
      if (!isCurrent()) return;
      if (!data?.data?.status)
        throw new Error(
          data?.data?.message || data?.message || 'Unknown error'
        );
      setState({
        ...initialState,
        revision,
        status: FaucetStatusResponse.SUCCESS,
        txHash: data.data.hash,
      });
      const refresh = async () => {
        if (!isCurrent()) return;
        try {
          await controllerEmitter(['callGetLatestUpdateForAccount']);
        } catch (error) {
          if (isCurrent())
            console.warn(
              'Failed to update balance after faucet transaction:',
              error
            );
        }
      };
      void refresh();
      if (!isCurrent()) return;
      createTemporaryAlarm({ delayInSeconds: 10, callback: refresh });
    } catch (error: any) {
      if (isCurrent())
        setState({
          ...initialState,
          revision,
          status: FaucetStatusResponse.ERROR,
          errorMessage: error.message || 'An error occurred',
        });
    }
  }, [scope, activeNetwork.chainId, account?.address, controllerEmitter]);

  const handleFaucetButton = useCallback(() => {
    const live = getFaucetContext(store.getState());
    if (
      !owner.current.active ||
      !live.eligible ||
      !live.ready ||
      live.scope !== scope
    )
      return;
    if (currentState.status === FaucetStatusResponse.REQUEST) {
      void handleRequestFaucet();
    } else if (currentState.status === FaucetStatusResponse.ERROR) {
      try {
        window.open(getExternalFaucetUrl(), '_blank', 'noopener,noreferrer');
      } catch {
        navigate('/home');
      }
    } else if (currentState.status === FaucetStatusResponse.SUCCESS) {
      navigate('/home');
    }
  }, [scope, currentState.status, handleRequestFaucet, navigate]);

  return {
    account,
    eligible,
    ready,
    faucetRequestDetails,
    handleFaucetButton,
    handleRequestFaucet,
    ...currentState,
  };
};
