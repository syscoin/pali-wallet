import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';

export const useStore = () => {
  const {
    status,
    accounts,
    activeAccountId,
    activeNetwork,
    encriptedMnemonic,
    confirmingTransaction,
    creatingAsset,
    issuingAsset,
    issuingNFT,
    mintNFT,
    updatingAsset,
    transferringOwnership,
    changingNetwork,
    signingTransaction,
    signingPSBT,
    walletTokens,
    tabs,
    timer,
  }: IWalletState = useSelector((state: RootState) => state.wallet);

  const {
    currentSenderURL,
    currentURL,
    canConnect,
    connections,
  } = tabs;

  return {
    status,
    accounts,
    activeAccountId,
    activeNetwork,
    encriptedMnemonic,
    confirmingTransaction,
    creatingAsset,
    issuingAsset,
    issuingNFT,
    mintNFT,
    updatingAsset,
    transferringOwnership,
    changingNetwork,
    signingTransaction,
    signingPSBT,
    walletTokens,
    timer,
    tabs,
    currentSenderURL,
    currentURL,
    canConnect,
    connections,
  }
}