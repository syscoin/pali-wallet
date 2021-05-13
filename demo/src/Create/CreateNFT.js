import React, { Component, useEffect, useState, useCallback } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'react-dropzone-uploader/dist/styles.css'
import Header from "../components/Header";
import FormCreateToken from '../components/FormCreateToken';

const CreateNFT = () => {
  const [preview, setPreview] = useState("");
  const [isInstalled, setIsInstalled] = useState(false);
  const [canConnect, setCanConnect] = useState(true);
  const [balance, setBalance] = useState(0);
  const [controller, setController] = useState();
  const [connectedAccount, setConnectedAccount] = useState({});
  const [connectedAccountAddress, setConnectedAccountAddress] = useState('');
  const [amount, setAmount] = useState(0);
  const [fee, setFee] = useState(0.00001);
  const [toAddress, setToAddress] = useState('');
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [checked, setChecked] = useState(false);

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

  const handleCreateNFT = (event, { precision, maxSupply, description, symbol, fee, sysAddress, rbf }) => {
    event.preventDefault();

    // await controller.handleCreateNFT(precision, maxSupply, description, symbol, fee, sysAddress, rbf);

    console.log('handle create nft', precision, maxSupply, description, symbol, fee, sysAddress, rbf)
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
            <FormCreateToken
              formCallback={handleCreateNFT}
              token="NFT"
            />
          </div>
        </div>
      ) : (
        <div>
          <p>...</p>
        </div>
      )}
    </div>
  );
}
export default CreateNFT;




