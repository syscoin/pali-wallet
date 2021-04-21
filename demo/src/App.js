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
  const [fee, setFee] = useState(0.0000001);
  const [toAddress, setToAddress] = useState('');
  const [confirmedTransaction, setConfirmedTransaction] = useState(false);

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

  const handleGetWalletState = async () => {
    return await controller.getWalletState();
  }

  const transferSYS = (sender, receiver, amount, fee) => {
    controller.transferSYS(sender, receiver, amount, fee).then(res => {
      console.log('res transfer', res)
    })
  }

  const handleSendNFT= async () => {
    return await controller.handleSendNFT();
  }

  const handleSendSPT= async () => {
    return await controller.handleSendSPT();
  }

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
            <input
              placeholder="amount"
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
              onClick={() => transferSYS(connectedAccountAddress, toAddress, amount, fee)}
            >
              send sys
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

            <button
              className="button"
              onClick={handleSendNFT}
            >
              send NFT
            </button>

            <button
              className="button"
              onClick={handleSendSPT}
            >
              send SPT
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
