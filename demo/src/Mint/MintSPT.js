import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css';
import FormMintSPT from "./Form/FormMintSPT";
import Header from "../components/Header";

const MintSPT = () => {
  const [isInstalled, setIsInstalled] = useState(false);
  const [canConnect, setCanConnect] = useState(true);
  const [balance, setBalance] = useState(0);
  const [controller, setController] = useState();
  const [connectedAccount, setConnectedAccount] = useState({});
  const [connectedAccountAddress, setConnectedAccountAddress] = useState('');

  useEffect(() => {
    const callback = async (event) => {
      if (event.detail.SyscoinInstalled) {
        setIsInstalled(true);

        if (event.detail.ConnectionsController) {
          setController(window.ConnectionsController);

          return;
        }

        return;
      }

      setIsInstalled(false);

      window.removeEventListener('SyscoinStatus', callback);
    }

    window.addEventListener('SyscoinStatus', callback);
  }, []);

  const setup = async () => {
    const state = await controller.getWalletState();

    if (state.accounts.length > 0) {
      controller.getConnectedAccount()
        .then((data) => {
          if (data) {
            setConnectedAccount(data);
            setConnectedAccountAddress(data.address.main);
            setBalance(data.balance);
          } else {
            setConnectedAccount({});
            setConnectedAccountAddress('');
            setBalance(0);
          }      
          return;
        });
    }
  };

  useEffect(() => {
    if (controller) {
      setup();

      controller.onWalletUpdate(setup);
    }
  }, [
    controller,
  ]);

  const handleIssueAsset = async (event, { amount, fee, description, rbf, assetGuid }) => {
    event.preventDefault();

    console.log('handle mint spt', amount, fee, description, rbf, assetGuid)

    await controller.handleIssueAsset(
      rbf,
      fee,
      assetGuid,
      amount,
      description
    );
  };

  const handleMessageExtension = async () => {
    await controller.connectWallet();
    await setup();
  };

  return (
    <div className="app">
      {controller ? (  
        <div>  
          <Header
            canConnect={canConnect}
            handleMessageExtension={handleMessageExtension}
            isInstalled={isInstalled}
            connectedAccountAddress={connectedAccountAddress}
          /> 

          <FormMintSPT formCallback={handleIssueAsset}/>
        </div>
        ) : (
        <div>
          <p>...</p>
        </div>
      )}
    </div>
    );
  }
  
  export default MintSPT;