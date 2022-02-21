import React, { useEffect } from 'react';
import {
  Routes,
  Route,
  useLocation,
  useParams,
  Navigate,
} from 'react-router-dom';
import { useController, useStore, useUtils, useBrowser } from 'hooks/index';

import {
  About,
  AutoLock,
  ConfirmPhrase,
  ConnectedAccounts,
  ConnectedSites,
  ConnectHardwareWallet,
  ConnectWallet,
  Create,
  CreateAccount,
  CreateAndIssueNFT,
  CreateAndIssueNFTConfirm,
  CreatePass,
  CreatePhrase,
  CreateTokenConfirm,
  Currency,
  CustomRPC,
  DeleteWallet,
  DetailsView,
  EditNetwork,
  Home,
  Import,
  MintNFT,
  MintNFTConfirm,
  MintToken,
  MintTokenConfirm,
  Phrase,
  PrivateKey,
  Receive,
  Send,
  SendConfirm,
  SignAndSend,
  SignPSBT,
  Start,
  TransferOwnership,
  TransferOwnershipConfirm,
  TrustedSites,
  UpdateAsset,
  UpdateAssetConfirm,
} from '../pages';

import { ProtectedRoute } from './ProtectedRoute';

export const Router = () => {
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

    if (route === '/tx/asset/update/confirm' && !hasUpdateAssetTx) {
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
          navigate('/tx/sign');
          return;

        case 'mintNFT':
          navigate('/tx/asset/nft/mint');
          return;

        case 'signPSBT':
          navigate('/tx/sign-psbt');
          return;

        case 'newAsset':
          navigate('/tx/create');
          return;

        case 'mintAsset':
          navigate('/tx/asset/issue');
          return;

        case 'newNFT':
          navigate('/tx/asset/nft/issue');
          return;

        case 'updateAsset':
          navigate('/tx/asset/update');
          return;

        case 'transferAsset':
          navigate('/tx/asset/transfer');
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
    <Routes>
      <Route path="/" element={<Start />} />
      <Route path="create-password" element={<CreatePass />} />
      <Route
        path="connect-wallet"
        element={<ProtectedRoute element={<ConnectWallet />} />}
      />
      <Route
        path="connected-accounts"
        element={<ProtectedRoute element={<ConnectedAccounts />} />}
      />
      <Route path="home" element={<ProtectedRoute element={<Home />} />} />
      <Route
        // ? maybe this route should belong to transaction scope
        path="home/tx-details"
        element={<ProtectedRoute element={<DetailsView />} />}
      />
      <Route path="import" element={<Import />} />
      <Route path="phrase/create" element={<CreatePhrase />} />
      <Route path="phrase/confirm" element={<ConfirmPhrase />} />
      <Route
        path="/receive"
        element={<ProtectedRoute element={<Receive />} />}
      />
      <Route path="send" element={<ProtectedRoute element={<Send />} />} />
      <Route
        path="send/confirm"
        element={<ProtectedRoute element={<SendConfirm />} />}
      />
      <Route
        path="send/:address"
        element={
          <ProtectedRoute element={<Send initAddress={params.address} />} />
        }
      />
      {/* /settings */}
      <Route path="settings">
        <Route path="about" element={<ProtectedRoute element={<About />} />} />
        <Route
          path="autolock"
          element={<ProtectedRoute element={<AutoLock />} />}
        />
        <Route
          path="currency"
          element={<ProtectedRoute element={<Currency />} />}
        />
        <Route
          path="delete-wallet"
          element={<ProtectedRoute element={<DeleteWallet />} />}
        />
        <Route
          path="phrase"
          element={<ProtectedRoute element={<Phrase />} />}
        />
        {/* /settings/account */}
        <Route path="account">
          <Route
            path="hardware"
            element={<ProtectedRoute element={<ConnectHardwareWallet />} />}
          />
          <Route
            path="new"
            element={<ProtectedRoute element={<CreateAccount />} />}
          />
          <Route
            path="private-key"
            element={<ProtectedRoute element={<PrivateKey />} />}
          />
        </Route>
        {/* /settings/networks */}
        <Route path="networks">
          <Route
            path="connected-sites"
            element={<ProtectedRoute element={<ConnectedSites />} />}
          />
          <Route
            path="custom-rpc"
            element={<ProtectedRoute element={<CustomRPC />} />}
          />
          <Route
            path="edit"
            element={<ProtectedRoute element={<EditNetwork />} />}
          />
          <Route
            path="trusted-sites"
            element={<ProtectedRoute element={<TrustedSites />} />}
          />
        </Route>
      </Route>
      {/* /tx */}
      <Route path="tx">
        <Route
          path="create"
          element={<ProtectedRoute element={<Create />} />}
        />
        <Route
          path="create/confirm"
          element={<ProtectedRoute element={<CreateTokenConfirm />} />}
        />
        <Route
          path="sign"
          element={<ProtectedRoute element={<SignAndSend />} />}
        />
        <Route
          path="sign-psbt"
          element={<ProtectedRoute element={<SignPSBT />} />}
        />
        {/* /tx/asset */}
        <Route path="asset">
          <Route
            path="issue"
            element={<ProtectedRoute element={<MintToken />} />}
          />
          <Route
            path="issue/confirm"
            element={<ProtectedRoute element={<MintTokenConfirm />} />}
          />
          <Route
            path="transfer"
            element={<ProtectedRoute element={<TransferOwnership />} />}
          />
          <Route
            path="transfer/confirm"
            element={<ProtectedRoute element={<TransferOwnershipConfirm />} />}
          />
          <Route
            path="update"
            element={<ProtectedRoute element={<UpdateAsset />} />}
          />
          <Route
            path="update/confirm"
            element={<ProtectedRoute element={<UpdateAssetConfirm />} />}
          />
          {/* /tx/asset/nft */}
          <Route path="nft">
            <Route
              path="issue"
              element={<ProtectedRoute element={<CreateAndIssueNFT />} />}
            />
            <Route
              path="issue/confirm"
              element={
                <ProtectedRoute element={<CreateAndIssueNFTConfirm />} />
              }
            />
            <Route
              path="mint"
              element={<ProtectedRoute element={<MintNFT />} />}
            />
            <Route
              path="mint/confirm"
              element={<ProtectedRoute element={<MintNFTConfirm />} />}
            />
          </Route>
        </Route>
      </Route>
      <Route path="app.html" element={<Navigate to={{ pathname: '/' }} />} />
    </Routes>
  );
};
