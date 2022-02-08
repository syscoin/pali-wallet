import React, { useEffect } from 'react';
import { Import } from 'containers/common/Import';
import { Routes, Route, useLocation, useParams } from 'react-router-dom';
import { useController, useStore, useUtils, useBrowser } from 'hooks/index';
import {
  Home,
  Receive,
  ConnectWallet,
  ConnectedAccounts,
  Send,
  SendConfirm,
  Start,
  DetailsView,
} from 'containers/auth';
import {
  AboutView,
  AutolockView,
  ConnectHardwareWalletView,
  CurrencyView,
  DeleteWalletView,
  NewAccountView,
  PhraseView,
  PrivateKeyView,
  EditNetworkView,
  CustomRPCView,
  ConnectedSitesView,
  TrustedSitesView,
} from 'containers/auth/Settings/views';
import {
  Create,
  CreateTokenConfirm,
  UpdateAsset,
  UpdateAssetConfirm,
  TransferOwnership,
  TransferOwnershipConfirm,
  MintNFT,
  MintNFTConfirm,
  SignAndSend,
  SignPSBT,
  MintToken,
  MintTokenConfirm,
  CreateAndIssueNFT,
  CreateAndIssueNFTConfirm,
} from 'containers/auth/Transactions/views';
import { ConfirmPhrase, CreatePass, CreatePhrase } from 'containers/unauth';

import { ProtectedRoute } from './ProtectedRoute';

export const AuthRouter = () => {
  const params = useParams();
  const location = useLocation();
  const controller = useController();
  const { getConnectedAccount, getTemporaryTransaction } =
    controller.wallet.account;

  const { accounts, canConnect, temporaryTransactionState } = useStore();
  const { alert, navigate } = useUtils();
  const { browser } = useBrowser();

  const connectedAccount = getConnectedAccount();
  const isUnlocked = !controller.wallet.isLocked();

  useEffect(() => {
    if (isUnlocked) {
      window.addEventListener('mousemove', () => {
        browser.runtime.sendMessage({
          type: 'SET_MOUSE_MOVE',
          target: 'background',
        });
      });
    }
  }, [isUnlocked, browser.runtime]);

  useEffect(() => {
    const route = controller.appRoute();
    const { executing, type } = temporaryTransactionState;

    const hasSendAssetTx = getTemporaryTransaction('sendAsset') !== null;
    const hasUpdateAssetTx = getTemporaryTransaction('updateAsset') !== null;

    if (
      route === '/send/confirm' &&
      !hasSendAssetTx &&
      !executing &&
      type !== 'sendAsset'
    ) {
      navigate('/home');
      return;
    }

    if (route === '/transaction/update-asset/confirm' && !hasUpdateAssetTx) {
      navigate('/home');
      return;
    }

    if (!isUnlocked && accounts.length > 0) {
      navigate('/');
      return;
    }

    if (executing && isUnlocked) {
      if (type === 'sendAsset' && hasSendAssetTx) {
        navigate('/send/confirm');
        return;
      }

      switch (type) {
        case 'signAndSendPSBT':
          navigate('/transaction/sign');
          return;

        case 'mintNFT':
          navigate('/transaction/mint-nft');
          return;

        case 'signPSBT':
          navigate('/transaction/sign-psbt');
          return;

        case 'newAsset':
          navigate('/transaction/create');
          return;

        case 'mintAsset':
          navigate('/transaction/issue-asset');
          return;

        case 'newNFT':
          navigate('/transaction/issue-nft');
          return;

        case 'updateAsset':
          navigate('/transaction/update-asset');
          return;

        case 'transferAsset':
          navigate('/transaction/transfer-ownership');
          return;

        default:
          break;
      }
    }

    if (!executing && type !== 'sendAsset' && hasSendAssetTx) {
      navigate('/home');
      return;
    }

    if (isUnlocked) {
      if (canConnect) {
        if (connectedAccount) {
          navigate('/connected-accounts');
          return;
        }

        navigate('/connect-wallet');
        return;
      }

      navigate('/home');
      return;
    }

    if (route !== '/') navigate(route);
  }, [canConnect, isUnlocked]);

  useEffect(() => {
    alert.removeAll();
    controller.appRoute(location.pathname);
  }, [location]);

  return (
    <div className="w-full min-w-popup h-full min-h-popup">
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="/create-password" element={<CreatePass />} />

        {/* Connections */}
        <Route
          path="/connect-wallet"
          element={<ProtectedRoute element={<ConnectWallet />} />}
        />
        <Route
          path="/connected-accounts"
          element={<ProtectedRoute element={<ConnectedAccounts />} />}
        />

        {/* Home */}
        <Route path="/home" element={<ProtectedRoute element={<Home />} />} />
        <Route
          // ? maybe this route should belong to transaction scope
          path="/home/tx-details"
          element={<ProtectedRoute element={<DetailsView />} />}
        />

        <Route path="/import" element={<Import />} />
        <Route path="/phrase/create" element={<CreatePhrase />} />
        <Route path="/phrase/confirm" element={<ConfirmPhrase />} />

        {/* Transactions */}
        <Route
          path="/transaction/sign"
          element={<ProtectedRoute element={<SignAndSend />} />}
        />
        <Route
          path="/transaction/sign-psbt"
          element={<ProtectedRoute element={<SignPSBT />} />}
        />
        <Route
          path="/transaction/create"
          element={<ProtectedRoute element={<Create />} />}
        />
        <Route
          path="/transaction/create/confirm"
          element={<ProtectedRoute element={<CreateTokenConfirm />} />}
        />
        <Route
          path="/transaction/issue-asset"
          element={<ProtectedRoute element={<MintToken />} />}
        />
        <Route
          path="/transaction/issue-asset/confirm"
          element={<ProtectedRoute element={<MintTokenConfirm />} />}
        />
        <Route
          path="/transaction/issue-nft"
          element={<ProtectedRoute element={<CreateAndIssueNFT />} />}
        />
        <Route
          path="/transaction/issue-nft/confirm"
          element={<ProtectedRoute element={<CreateAndIssueNFTConfirm />} />}
        />
        <Route
          path="/transaction/mint-nft"
          element={<ProtectedRoute element={<MintNFT />} />}
        />
        <Route
          path="/transaction/mint-nft/confirm"
          element={<ProtectedRoute element={<MintNFTConfirm />} />}
        />
        <Route
          path="/transaction/update-asset"
          element={<ProtectedRoute element={<UpdateAsset />} />}
        />
        <Route
          path="/transaction/update-asset/confirm"
          element={<ProtectedRoute element={<UpdateAssetConfirm />} />}
        />
        <Route
          path="/transaction/transfer-ownership"
          element={<ProtectedRoute element={<TransferOwnership />} />}
        />
        <Route
          path="/transaction/transfer-ownership/confirm"
          element={<ProtectedRoute element={<TransferOwnershipConfirm />} />}
        />

        {/* Send */}
        <Route path="/send" element={<ProtectedRoute element={<Send />} />} />
        <Route
          path="/send/:address"
          element={
            <ProtectedRoute element={<Send initAddress={params.address} />} />
          }
        />
        <Route
          path="/send/confirm"
          element={<ProtectedRoute element={<SendConfirm />} />}
        />

        {/* Receive */}
        <Route
          path="/receive"
          element={<ProtectedRoute element={<Receive />} />}
        />

        {/* Settings */}
        <Route
          path="/settings/about"
          element={<ProtectedRoute element={<AboutView />} />}
        />
        <Route
          path="/settings/autolock"
          element={<ProtectedRoute element={<AutolockView />} />}
        />
        <Route
          path="/settings/currency"
          element={<ProtectedRoute element={<CurrencyView />} />}
        />
        <Route
          path="/settings/delete-wallet"
          element={<ProtectedRoute element={<DeleteWalletView />} />}
        />
        <Route
          path="/settings/phrase"
          element={<ProtectedRoute element={<PhraseView />} />}
        />
        <Route
          path="/settings/account/hardware"
          element={<ProtectedRoute element={<ConnectHardwareWalletView />} />}
        />
        <Route
          path="/settings/account/new"
          element={<ProtectedRoute element={<NewAccountView />} />}
        />
        <Route
          path="/settings/account/private-key"
          element={<ProtectedRoute element={<PrivateKeyView />} />}
        />
        <Route
          path="/settings/networks/edit"
          element={<ProtectedRoute element={<EditNetworkView />} />}
        />
        <Route
          path="/settings/networks/custom-rpc"
          element={<ProtectedRoute element={<CustomRPCView />} />}
        />
        <Route
          path="/settings/networks/connected-sites"
          element={<ProtectedRoute element={<ConnectedSitesView />} />}
        />
        <Route
          path="/settings/networks/trusted-sites"
          element={<ProtectedRoute element={<TrustedSitesView />} />}
        />
      </Routes>
    </div>
  );
};
