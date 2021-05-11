import { useEffect, useState, useCallback } from "react";
import logo from "./assets/images/logosys.svg";
import ReactTooltip from 'react-tooltip';
import Switch from "react-switch";
import HelpOutlineIcon from '@material-ui/icons/HelpOutline';
import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css'

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

  const handleTypeChanged = useCallback((checked) => {
    setChecked(checked)
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

            return;
          }

          setConnectedAccount({});
          setConnectedAccountAddress('');
          setBalance(0);

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
    console.log("Sending tokens");
    // await controller.handleCreateToken(8,
    //   'NikBar',
    //   1000,
    //    0.00001,
    //   'larara lelere lololo lululu',
    //   'tsys1qvaf78steqrvsljch9mn6n559ljj5g2xs7gvepq',
    //   false);
    // (rbf: boolean, fee: number, assetGuid: string, amount: number, receiver: string
    await controller.handleIssueAsset(
      false,
      0.00001,
      'umasset',
      200,
      'txsdkasod'
    )
    //(rbf: boolean, fee: number, assetGuid: string, nfthash: string, receiver: string) => {
    // await controller.handleIssueNFT(
    //   true,
    //   0.0001,
    //   'umassetguid',
    //   'umnfthash',
    //   'umaconta'
    // )
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
      await controller.handleSendToken(sender, receiver, amount, fee, token, true, !checked);

      clearData(inputs);

      return;
    }

    await controller.handleSendToken(sender, receiver, amount, fee, null, false, !checked);

    clearData(inputs);

    return;
  }
  return (
    <div className="app">

      {controller ? (
        <div>
          <nav className="navbar navbar-expand-lg navbar-light  static-top">
            <div className="container">
              <a className="navbar-brand" href="https://syscoin.org/">
                <img src={logo} alt="logo" className="header__logo"></img>
              </a>
              <div className="collapse navbar-collapse" id="navbarResponsive">
                <ul className="navbar-nav ml-auto">
                  <div className="header__info">

                    <button
                      className="button"
                      onClick={canConnect ? handleMessageExtension : undefined}
                      disabled={!isInstalled}>
                      {connectedAccountAddress === '' ? 'Connect to Syscoin Wallet' : connectedAccountAddress}
                    </button>  </div>
                </ul>

              </div>
            </div>
          </nav>
          {!isInstalled && (<h1 className="app__title">You need to install Syscoin Wallet.</h1>)}

          <div className="menu">
            <a className="button" href="/mintnft">Mint NFT</a>
            <a className="button" href="/createnft">Create NFT</a>
            <a className="button" href="/createcollection">Create Collection</a>
            <a className="button" href="/createspt">Create SPT</a>
            <a className="button" href="/mintspt">Mint SPT</a>
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
