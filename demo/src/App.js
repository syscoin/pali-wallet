import { useEffect, useState } from "react";
import logo from "./assets/images/logosys.svg";

const App = () => {
  const [isInstalled, setIsInstalled] = useState(false);
  const [canConnect, setCanConnect] = useState(true);
  const [balance, setBalance] = useState(0);
  const [controller, setController] = useState();
  const [connectedAccount, setConnectedAccount] = useState({});
  const [connectedAccountAddress, setConnectedAccountAddress] = useState('');
  const [amount, setAmount] = useState(0);
  const [fee, setFee] = useState(0.00001);
  const [toAddress, setToAddress] = useState('');
  const [confirmedTransaction, setConfirmedTransaction] = useState(false);
  const [selectedAsset,setSelectedAsset] = useState(null);

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

  const handleAssetSelected = (event) => {
    if (connectedAccount) {
      const selectedAsset = connectedAccount.assets.filter((asset) => asset.assetGuid == event.target.value);

      if (selectedAsset[0]) {
        setSelectedAsset(selectedAsset[0]);

        return;
      }

      setSelectedAsset(null);
    }
  };

  const handleMessageExtension = async () => {
    await controller.connectWallet();
    await setup();
  }

  const handleGetWalletState = async () => {
    return await controller.getWalletState();
  }

  const clearData = (inputs) => {
    for (let input of inputs) {
      input.value = '';
    }

    setToAddress('');
    setAmount(0);
    setFee(0.00001);
  }

  const handleSendToken = async (sender, receiver, amount, fee, token) => {
    const inputs = document.querySelectorAll('input');

    if (token !== null) {
      await controller.handleSendToken(sender, receiver, amount, fee, token, true, true);

      clearData(inputs);

      return;
    }

    await controller.handleSendToken(sender, receiver, amount, fee, null, false, true);

    clearData(inputs);

    return;
  }

  console.log('asd', toAddress, amount, fee)

  return (
    <div className="app">
      {controller ? (
        <div>
          <header className="header">
            <img src={logo} alt="logo" className="header__logo" />

            <div className="header__info">
              <p className="header__balance">{balance}</p>

              <button
                className="button"
                onClick={canConnect ? handleMessageExtension : undefined}
                disabled={!isInstalled}
              >
                {connectedAccountAddress === '' ? 'Connect to Syscoin Wallet' : connectedAccountAddress}
              </button>
            </div>
          </header>

          {!isInstalled && (<h1 className="app__title">You need to install Syscoin Wallet.</h1>)}

          <table className="table">
            <thead>
              <tr>
                <td>Accounts</td>
                <td>Balance</td>
                <td>Address</td>
              </tr>
            </thead>

            <tbody id="tbody">
              {connectedAccount.label && (
                <tr>
                  <td>{connectedAccount.label}</td>
                  <td>{connectedAccount.balance}</td>
                  <td>{connectedAccountAddress}</td>
                </tr>                
              )}
            </tbody>
          </table>

          <form>
          <div>
          <select
            onChange={handleAssetSelected}
          >
            <optgroup label="Native">
              <option value={1}>SYS</option>
            </optgroup>

            <optgroup label="SPT">
              {connectedAccount.label && connectedAccount.assets.map((asset, idx) => {
                if(!controller.isNFT(asset.assetGuid)){
                 return <option key={idx} value={asset.assetGuid}>{asset.symbol}</option>
                }
                return
                })
              }
            </optgroup>

            <optgroup label="NFT">
              {connectedAccount.label && connectedAccount.assets.map((asset, idx) => {
                if(controller.isNFT(asset.assetGuid)){
                 return <option key={idx} value={asset.assetGuid}>{asset.symbol}</option>
                }

                return;
                })
              }
            </optgroup>
        </select>
        </div>
            <input
              placeholder={selectedAsset ? `${selectedAsset.symbol} amount` : "SYS amount"}
              type="number"
              onBlur={(event) => setAmount(event.target.value)}
            />

            <input
              placeholder="fee"
              type="number"
              onBlur={(event) => setFee(event.target.value)}
            />

            <input
              placeholder="to address"
              type="text"
              onBlur={(event) => setToAddress(event.target.value)}
            />

            <button
              className="button"
              disabled={
                toAddress === connectedAccountAddress ||
                connectedAccount.balance === 0 ||
                amount > connectedAccount.balance ||
                !amount ||
                !fee ||
                !toAddress
              }
              onClick={() => handleSendToken(connectedAccountAddress, toAddress, amount, fee, selectedAsset)}
            >
              send
            </button>
          </form>

          {connectedAccount.balance === 0 && (
            <p>You don't have SYS available.</p>
          )}

          <div className="buttons">
            <button
              className="button"
              onClick={handleGetWalletState}
            >
              console wallet state
            </button>
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

export default App;
