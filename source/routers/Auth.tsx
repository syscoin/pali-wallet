import React, { useEffect } from 'react';
import { Import } from 'containers/common/Import';
import {
  Routes,
  Route,
  // Redirect,
  useLocation,
  useParams,
} from 'react-router-dom';
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
} from 'containers/auth/index';
import {
  AboutView,
  AccountView,
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

export const AuthRouter = () => {
  const location = useLocation();
  const controller = useController();
  const isUnlocked = !controller.wallet.isLocked();
  const params = useParams();

  const { getHost, alert, navigate } = useUtils();
  const { browser } = useBrowser();

  const { accounts, currentURL, canConnect, temporaryTransactionState } =
    useStore();

  const connectedAccounts = accounts.filter(
    (account) =>
      account.connectedTo.findIndex((url: any) => url === getHost(currentURL)) >
      -1
  );

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
    const redirectRoute = controller.appRoute();

    if (
      redirectRoute === '/send/confirm' &&
      !controller.wallet.account.getTemporaryTransaction('sendAsset') &&
      !temporaryTransactionState.executing &&
      temporaryTransactionState.type !== 'sendAsset'
    ) {
      navigate('/home');

      return;
    }

    if (
      redirectRoute === '/updateAsset/confirm' &&
      !controller.wallet.account.getTemporaryTransaction('updateAsset')
    ) {
      navigate('/home');

      return;
    }

    if (!isUnlocked && accounts.length > 0) {
      navigate('/app.html');

      return;
    }

    if (
      temporaryTransactionState.executing &&
      temporaryTransactionState.type === 'sendAsset' &&
      controller.wallet.account.getTemporaryTransaction('sendAsset') &&
      isUnlocked
    ) {
      navigate('/send/confirm');

      return;
    }

    if (
      temporaryTransactionState.executing &&
      temporaryTransactionState.type === 'signAndSendPSBT' &&
      isUnlocked
    ) {
      navigate('/sign');

      return;
    }

    if (
      temporaryTransactionState.executing &&
      temporaryTransactionState.type === 'mintNFT' &&
      isUnlocked
    ) {
      navigate('/mintNFT');

      return;
    }

    if (
      temporaryTransactionState.executing &&
      temporaryTransactionState.type === 'signPSBT' &&
      isUnlocked
    ) {
      navigate('/signPsbt');

      return;
    }

    if (
      temporaryTransactionState.executing &&
      temporaryTransactionState.type === 'newAsset' &&
      isUnlocked
    ) {
      navigate('/create');

      return;
    }

    if (
      temporaryTransactionState.executing &&
      temporaryTransactionState.type === 'mintAsset' &&
      isUnlocked
    ) {
      navigate('/issueAsset');

      return;
    }

    if (
      temporaryTransactionState.executing &&
      temporaryTransactionState.type === 'newNFT' &&
      isUnlocked
    ) {
      navigate('/issueNFT');

      return;
    }

    if (
      temporaryTransactionState.executing &&
      temporaryTransactionState.type === 'updateAsset' &&
      isUnlocked
    ) {
      navigate('/updateAsset');

      return;
    }

    if (
      temporaryTransactionState.executing &&
      temporaryTransactionState.type === 'transferAsset' &&
      isUnlocked
    ) {
      navigate('/transferOwnership');

      return;
    }

    if (
      !temporaryTransactionState.executing &&
      temporaryTransactionState.type !== 'sendAsset' &&
      controller.wallet.account.getTemporaryTransaction('sendAsset')
    ) {
      navigate('/home');

      return;
    }

    if (canConnect && isUnlocked) {
      if (connectedAccounts.length <= 0) {
        navigate('/connect-wallet');

        return;
      }

      navigate('/connected-accounts');

      return;
    }

    if (!canConnect && isUnlocked) {
      if (connectedAccounts.length > 0) {
        navigate('/home');

        return;
      }

      navigate('/home');

      return;
    }

    if (
      temporaryTransactionState.executing &&
      temporaryTransactionState.type === 'sendAsset' &&
      !canConnect &&
      isUnlocked
    ) {
      navigate('/send/confirm');

      return;
    }

    if (redirectRoute !== '/app.html') {
      navigate(redirectRoute);
    }
  }, [canConnect, isUnlocked]);

  useEffect(() => {
    alert.removeAll();
    controller.appRoute(location.pathname);
  }, [location]);

  return (
    <>
      <div className="w-full min-w-popup h-full min-h-popup">
        <Routes>
          <Route path="/app.html" element={<Start />} />

          {isUnlocked ? (
            <>
              <Route path="/home" element={<Home />} />
              <Route path="/home-tx-details" element={<DetailsView />} />
              <Route path="/send/confirm" element={<SendConfirm />} />
              <Route path="/sign" element={<SignAndSend />} />
              <Route path="/signPsbt" element={<SignPSBT />} />
              <Route path="/create" element={<Create />} />
              <Route path="/create/confirm" element={<CreateTokenConfirm />} />
              <Route path="/issueAsset" element={<MintToken />} />
              <Route
                path="/issueAsset/confirm"
                element={<MintTokenConfirm />}
              />
              <Route path="/issueNFT" element={<CreateAndIssueNFT />} />
              <Route
                path="/issueNFT/confirm"
                element={<CreateAndIssueNFTConfirm />}
              />
              <Route path="/mintNFT" element={<MintNFT />} />
              <Route path="/mintNFT/confirm" element={<MintNFTConfirm />} />
              <Route path="/updateAsset" element={<UpdateAsset />} />
              <Route
                path="/updateAsset/confirm"
                element={<UpdateAssetConfirm />}
              />
              <Route
                path="/transferOwnership"
                element={<TransferOwnership />}
              />
              <Route
                path="/transferOwnership/confirm"
                element={<TransferOwnershipConfirm />}
              />
              <Route path="/send" element={<Send />} />
              <Route
                path="/send/:address"
                element={<Send initAddress={params.address} />}
              />
              <Route path="/receive" element={<Receive />} />

              <Route path="/general-autolock" element={<AutolockView />} />
              <Route path="/general-about" element={<AboutView />} />
              <Route path="/general-phrase" element={<PhraseView />} />
              <Route path="/general-delete" element={<DeleteWalletView />} />
              <Route path="/general-currency" element={<CurrencyView />} />

              <Route path="/account-priv" element={<PrivateKeyView />} />
              <Route
                path="/account-hardware"
                element={<ConnectHardwareWalletView />}
              />
              <Route path="/account-newaccount" element={<NewAccountView />} />
              <Route path="/account-details" element={AccountView} />

              <Route path="/networks-edit" element={<EditNetworkView />} />
              <Route path="/networks-custom" element={<CustomRPCView />} />
              <Route path="/networks-sites" element={<ConnectedSitesView />} />
              <Route path="/networks-trusted" element={<TrustedSitesView />} />

              {canConnect && (
                <>
                  <Route path="/connect-wallet" element={<ConnectWallet />} />

                  {connectedAccounts.length > 0 && (
                    <>
                      <Route
                        path="/connected-accounts"
                        element={<ConnectedAccounts />}
                      />
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <Route path="/import" element={<Import />} />
            </>
          )}
        </Routes>
      </div>
    </>
  );
};
