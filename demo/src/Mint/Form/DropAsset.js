import React, { useState, useEffect } from "react";

const Dropdown = () => {

    const [assetGuid, setAssetGuid] = useState('');
    const [receiver, setReceiver] = useState('');
    const [rbf, setRbf] = useState(false);
    const [amount, setAmount] = useState(0);
    const [data, setData] = useState([]);
    const [isInstalled, setIsInstalled] = useState(false);
    const [canConnect, setCanConnect] = useState(true);
    const [balance, setBalance] = useState(0);
    const [controller, setController] = useState();
    const [connectedAccount, setConnectedAccount] = useState({});
    const [connectedAccountAddress, setConnectedAccountAddress] = useState("");
  
    useEffect(() => {
      const callback = (event) => {
        if (event.detail.SyscoinInstalled) {
          setIsInstalled(true);
  
          if (event.detail.ConnectionsController) {
            setController(window.ConnectionsController);
  
            return;
          }
  
          return;
        }
  
        setIsInstalled(false);
  
        window.removeEventListener("SyscoinStatus", callback);
      }
  
      window.addEventListener("SyscoinStatus", callback);
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
            setConnectedAccountAddress("");
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
  
    useEffect(() => {
      console.log('tokens', data);
  
      const setup = async () => {
        if (controller) {
          console.log('torewkens');
          setData(await controller.getUserMintedTokens());
        }
      }
  
      setup();
    }, [
      controller
    ]);
  
    const RenderAsset = () => {
       return data.map((asset, index) => {
       return <option key={index}>Symbol:"{asset.symbol}"   Asset: "{asset.assetGuid}"</option>
       });
     }
  
    return (
<form
    onSubmit={(props) => props.formCallback(
      assetGuid
    )}
  >
                    <div className="input-group mb-3">
            <label htmlFor="assetGuid">AssetGuid:</label>

            <select
              id="assetGuid" 
              name="assetGuid" 
              className="custom-select"
              onBlur={(event) => setAssetGuid(event.target.value)}
            >
              <option>{assetGuid}</option>
              <RenderAsset />
            </select>
          </div>
          </form>
    );
  }

export default Dropdown;