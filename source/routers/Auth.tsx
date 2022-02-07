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
} from 'containers/auth/index';
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
        if (!connectedAccount) {
          navigate('/connect-wallet');
          return;
        }

        navigate('/connected-accounts');
        return;
      }

      if (connectedAccount) {
        navigate('/home');
        return;
      }

      navigate('/home');
      return;

      // ! this part was unreacheable
      /* if (executing && type === 'sendAsset' && !canConnect) {
        navigate('/send/confirm');
        return;
      } */
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
            <Route path="/issueAsset/confirm" element={<MintTokenConfirm />} />
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
            <Route path="/transferOwnership" element={<TransferOwnership />} />
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

            <Route path="/networks-edit" element={<EditNetworkView />} />
            <Route path="/networks-custom" element={<CustomRPCView />} />
            <Route path="/networks-sites" element={<ConnectedSitesView />} />
            <Route path="/networks-trusted" element={<TrustedSitesView />} />

            {
              // ? this seems to be a boolean
            }
            {canConnect && (
              <>
                <Route path="/connect-wallet" element={<ConnectWallet />} />

                {connectedAccount && (
                  <Route
                    path="/connected-accounts"
                    element={<ConnectedAccounts />}
                  />
                )}
              </>
            )}
          </>
        ) : (
          <Route path="/import" element={<Import />} />
        )}
      </Routes>
    </div>
  );
};
