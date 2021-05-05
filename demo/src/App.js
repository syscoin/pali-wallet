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
  const [selectedAsset,setSelectedAsset] = useState(null);
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
      <nav class="navbar navbar-expand-lg navbar-light  static-top">
         <div class="container">
           <a class="navbar-brand" href="https://syscoin.org/">
           <img src={logo} alt="logo" className="header__logo"></img>
               </a>
               <a   className="button" href="/sysmint">Mint NFT</a>
              <div class="collapse navbar-collapse" id="navbarResponsive">
             <ul class="navbar-nav ml-auto">
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

            <div>
              <div style={{ margin: "2rem 0" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <label style={{ margin: "0", fontSize: '0.9rem' }}> Z-DAG</label>

                  <HelpOutlineIcon
                    style={{ width: "0.9rem", height: "0.9rem" }}
                    data-tip data-for="zdag_info"
                  />
                </div>

                <ReactTooltip
                  id="zdag_info"
                  getContent={()=>
                    <ul style={{ listStyle: "none", margin: "0", padding: "0" }}>
                      <li style={{ margin: "0.5rem" }}>
                        <span>
                          OFF for Replace-by-fee(RBF) <br/> ON for Z-DAG
                        </span>
                      </li>

                      <li style={{ margin: "0.5rem" }}>
                        <span>
                          Z-DAG, a exclusive syscoin feature,<br/>
                          is a blockchain scalability sulution
                        </span>
                      </li>
                      
                      <li style={{ margin: "0.5rem" }}>
                        to know more: <br/>
                        <a href="https://syscoin.org/news/what-is-z-dag" target="_blank">
                          what is Z-DAG?
                        </a>
                      </li>
                    </ul>
                  }
                  effect='solid'
                  delayHide={100}
                  delayShow={100}
                  delayUpdate={500}
                  place={'left'}
                  border={true}
                  type={'info'}
                />
              </div>
             
              <Switch
                checked={checked}
                onChange={handleTypeChanged}
              ></Switch> <p className="header__balance">{balance}</p>
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
