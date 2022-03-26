// @ts-nocheck
import React, { useEffect } from 'react';
import {
  Routes,
  Route,
  useLocation,
  useParams,
  Navigate,
} from 'react-router-dom';
import { useQuery, useStore, useUtils } from 'hooks/index';
import { getController } from 'utils/browser';
import { browser } from 'webextension-polyfill-ts';

import {
  About,
  AutoLock,
  ConfirmPhrase,
  ChangeAccount,
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
  // const location = useLocation();
  const controller = getController();
  // const { getConnectedAccount, getTemporaryTransaction } =
  //   controller.wallet.account;

  const { temporaryTransactionState } = useStore();
  const { alert, navigate } = useUtils();
  const { pathname } = useLocation();

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

  const query = useQuery();
  const route = query.get('route');

  const txRoutes = (type: string) => {
    switch (type) {
      case 'sendAsset':
        navigate('/send/confirm');

        return;
      case 'signAndSendPSBT':
        navigate('/external/tx/sign');

        return;
      case 'mintNFT':
        navigate('/external/tx/asset/nft/mint');

        return;

      case 'signPSBT':
        navigate('/external/tx/sign-psbt');

        return;

      case 'newAsset':
        navigate('/external/tx/create');

        return;

      case 'mintAsset':
        navigate('/external/tx/asset/issue');

        return;

      case 'newNFT':
        navigate('/external/tx/asset/nft/issue');

        return;

      case 'updateAsset':
        navigate('/external/tx/asset/update');

        return;

      case 'transferAsset':
        navigate('/external/tx/asset/transfer');

        break;
      default:
        break;
    }
  };

  useEffect(() => {
    const { executing, type } = temporaryTransactionState;

    if (isUnlocked) {
      if (route === 'connect-wallet') {
        navigate('/connect-wallet');

        return;
      }

      if (executing) {
        txRoutes(type);

        return;
      }

      navigate('/home');
    }
  }, [isUnlocked, route]);

  useEffect(() => {
    alert.removeAll();
    controller.appRoute(pathname);
  }, [pathname]);

  return (
    <Routes>
      <Route path="/" element={<Start />} />

      <Route path="create-password" element={<CreatePass />} />
      <Route path="import" element={<Import />} />
      <Route path="phrase/create" element={<CreatePhrase />} />
      <Route path="phrase/confirm" element={<ConfirmPhrase />} />

      <Route path="external">
        <Route
          path="connect-wallet"
          element={<ProtectedRoute element={<ConnectWallet />} />}
        />

        <Route
          path="change-account"
          element={<ProtectedRoute element={<ChangeAccount />} />}
        />
      </Route>

      <Route path="home" element={<ProtectedRoute element={<Home />} />} />
      <Route
        // ? maybe this route should belong to transaction scope
        path="home/tx-details"
        element={<ProtectedRoute element={<DetailsView />} />}
      />

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
      <Route path="external/tx">
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
