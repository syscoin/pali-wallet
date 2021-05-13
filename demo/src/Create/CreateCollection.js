import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css';
import FormCollection from "./Form/FormCollection"
import Header from "../components/Header";

const CreateCollection = () => {
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

  const handleMessageExtension = async () => {
    await controller.connectWallet();
    await setup();
  }

  const handleCreateCollection = (event, {
    collectionName,
    description,
    sysAddress,
    symbol,
    property1,
    property2,
    property3,
    attribute1,
    attribute2,
    attribute3
  }) => {
    event.preventDefault();

    // await controller.handleCreateCollection(collectionName, description, sysAddress, symbol, property1, property2, property3, attribute1, attribute2, attribute3);

    console.log('handle create collection', collectionName, description, sysAddress, symbol, property1, property2, property3, attribute1, attribute2, attribute3)
  }

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

          <div className="form"> 
            <FormCollection formCallback={handleCreateCollection} />
          </div>
        </div>
      ) : (
        <div>
          <p>...</p>
          <h1>You need to install Syscoin Wallet.</h1>
        </div>
      )}
    </div>
  );
}
  
export default CreateCollection;