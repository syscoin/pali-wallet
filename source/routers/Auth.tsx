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

    if (route === '/updateAsset/confirm' && !hasUpdateAssetTx) {
      navigate('/home');
      return;
    }

    if (!isUnlocked && accounts.length > 0) {
      navigate('/app.html');
      return;
    }

    if (executing && isUnlocked) {
      if (type === 'sendAsset' && hasSendAssetTx) {
        navigate('/send/confirm');
        return;
      }

      switch (type) {
        case 'signAndSendPSBT':
          navigate('/sign');
          return;

        case 'mintNFT':
          navigate('/mintNFT');
          return;

        case 'signPSBT':
          navigate('/signPSBT');
          return;

        case 'newAsset':
          navigate('/create');
          return;

        case 'mintAsset':
          navigate('/issueAsset');
          return;

        case 'newNFT':
          navigate('/issueNFT');
          return;

        case 'updateAsset':
          navigate('/updateAsset');
          return;

        case 'transferAsset':
          navigate('/transferOwnership');
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

    if (route !== '/app.html') navigate(route);
  }, [canConnect, isUnlocked]);

  useEffect(() => {
    alert.removeAll();
    controller.appRoute(location.pathname);
  }, [location]);

  return (
    <div className="w-full min-w-popup h-full min-h-popup">
      <Routes>
        <Route path="/app.html" element={<Start />} />

        <Route path="/home" element={<ProtectedRoute element={<Home />} />} />
        <Route
          path="/home-tx-details"
          element={<ProtectedRoute element={<DetailsView />} />}
        />
        <Route
          path="/send/confirm"
          element={<ProtectedRoute element={<SendConfirm />} />}
        />
        <Route
          path="/sign"
          element={<ProtectedRoute element={<SignAndSend />} />}
        />
        <Route
          path="/signPsbt"
          element={<ProtectedRoute element={<SignPSBT />} />}
        />
        <Route
          path="/create"
          element={<ProtectedRoute element={<Create />} />}
        />
        <Route
          path="/create/confirm"
          element={<ProtectedRoute element={<CreateTokenConfirm />} />}
        />
        <Route
          path="/issueAsset"
          element={<ProtectedRoute element={<MintToken />} />}
        />
        <Route
          path="/issueAsset/confirm"
          element={<ProtectedRoute element={<MintTokenConfirm />} />}
        />
        <Route
          path="/issueNFT"
          element={<ProtectedRoute element={<CreateAndIssueNFT />} />}
        />
        <Route
          path="/issueNFT/confirm"
          element={<ProtectedRoute element={<CreateAndIssueNFTConfirm />} />}
        />
        <Route
          path="/mintNFT"
          element={<ProtectedRoute element={<MintNFT />} />}
        />
        <Route
          path="/mintNFT/confirm"
          element={<ProtectedRoute element={<MintNFTConfirm />} />}
        />
        <Route
          path="/updateAsset"
          element={<ProtectedRoute element={<UpdateAsset />} />}
        />
        <Route
          path="/updateAsset/confirm"
          element={<ProtectedRoute element={<UpdateAssetConfirm />} />}
        />
        <Route
          path="/transferOwnership"
          element={<ProtectedRoute element={<TransferOwnership />} />}
        />
        <Route
          path="/transferOwnership/confirm"
          element={<ProtectedRoute element={<TransferOwnershipConfirm />} />}
        />
        <Route path="/send" element={<ProtectedRoute element={<Send />} />} />
        <Route
          path="/send/:address"
          element={
            <ProtectedRoute element={<Send initAddress={params.address} />} />
          }
        />
        <Route
          path="/receive"
          element={<ProtectedRoute element={<Receive />} />}
        />

        <Route
          path="/general-autolock"
          element={<ProtectedRoute element={<AutolockView />} />}
        />
        <Route
          path="/general-about"
          element={<ProtectedRoute element={<AboutView />} />}
        />
        <Route
          path="/general-phrase"
          element={<ProtectedRoute element={<PhraseView />} />}
        />
        <Route
          path="/general-delete"
          element={<ProtectedRoute element={<DeleteWalletView />} />}
        />
        <Route
          path="/general-currency"
          element={<ProtectedRoute element={<CurrencyView />} />}
        />

        <Route
          path="/account-priv"
          element={<ProtectedRoute element={<PrivateKeyView />} />}
        />
        <Route
          path="/account-hardware"
          element={<ProtectedRoute element={<ConnectHardwareWalletView />} />}
        />
        <Route
          path="/account-newaccount"
          element={<ProtectedRoute element={<NewAccountView />} />}
        />

        <Route
          path="/networks-edit"
          element={<ProtectedRoute element={<EditNetworkView />} />}
        />
        <Route
          path="/networks-custom"
          element={<ProtectedRoute element={<CustomRPCView />} />}
        />
        <Route
          path="/networks-sites"
          element={<ProtectedRoute element={<ConnectedSitesView />} />}
        />
        <Route
          path="/networks-trusted"
          element={<ProtectedRoute element={<TrustedSitesView />} />}
        />

        {canConnect && (
          <>
            <Route
              path="/connect-wallet"
              element={<ProtectedRoute element={<ConnectWallet />} />}
            />

            {connectedAccount && (
              <Route
                path="/connected-accounts"
                element={<ProtectedRoute element={<ConnectedAccounts />} />}
              />
            )}
          </>
        )}
        <Route path="/import" element={<Import />} />
      </Routes>
    </div>
  );
};
