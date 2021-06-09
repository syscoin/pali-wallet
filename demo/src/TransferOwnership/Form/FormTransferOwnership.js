import React, { useState, useEffect } from "react";

const FormTransferOwnership = (props) => {
  const [assetGuid, setAssetGuid] = useState('');
  const [newOwner, setNewOwner] = useState('');
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

    const setup = () => {
      if (controller) {
        controller.getUserMintedTokens().then((response) => {
          console.log(response);

          setData(response);
        });
      }
    }

    setup();
  }, [
    controller
  ]);

  const RenderAsset = () => {
    return data.map((asset, index) => {
      return <option key={index}>{asset.assetGuid}</option>
    });
  }

  return (
    <form
      onSubmit={(event) => props.formCallback(
        event,
        assetGuid,
        newOwner
      )}
    >
      <fieldset>
        <legend>TRANSFER OWNERSHIP</legend>

        <div>
          <div className="input-group mb-3">
            <label htmlFor="assetGuid">AssetGuid:</label>

            <select
              id="assetGuid" 
              name="assetGuid" 
              className="custom-select"
              onChange={(event) => setAssetGuid(event.target.value)}
            >
              <option>Choose...</option>
              <RenderAsset />
            </select>
          </div>

          <label htmlFor="newowner">New owner address:</label>
          <input 
            className="input" 
            type="text" 
            id="newowner" 
            name="newowner"
            onBlur={(event) => setNewOwner(event.target.value)}
          />
        </div>
      </fieldset>
      
      <button
        className="button" 
        type="submit"
        disabled={
          !assetGuid ||
          !newOwner
        }

        onClick={() => console.log('asset guid', assetGuid)}
      >
        transfer
      </button>
    </form>
  );
}

export default FormTransferOwnership;
