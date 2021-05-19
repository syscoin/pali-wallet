import React, { useState, useEffect } from "react";

const FormMintNFT = (props) => {
  const [assetGuid, setAssetGuid] = useState('');
  const [receiver, setReceiver] = useState('');
  const [rbf, setRbf] = useState(false);
  const [nfthash, setNfthash] = useState(0);
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
        setData(await controller.getUserMintedTokens());
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
        nfthash,
        10,
        receiver,
        rbf,
      )}
    >
      <fieldset>
        <legend>YOU ARE MINTING NFTS</legend>

        <div>
          <div className="input-group mb-3">
            <label htmlFor="assetGuid">AssetGuid:</label>

            <select
              id="assetGuid" 
              name="assetGuid" 
              className="custom-select"
              onBlur={(event) => setAssetGuid(event.target.value)}
            >
              <option>Choose...</option>
              <RenderAsset />
            </select>
          </div>

          <label htmlFor="amount">NFT Hash:</label>
          <input 
            className="input" 
            type="text" 
            id="nfthash" 
            name="nfthash"
            onBlur={(event) => setNfthash(event.target.value)}
            required
          />

          <label htmlFor="receiver">Receiver:</label>
          <input 
            className="input" 
            type="text" 
            id="receiver" 
            name="receiver"
            onBlur={(event) => setReceiver(event.target.value)}
            required
          />

          <label htmlFor="rbf">RBF:</label>
          <input 
            id="rbf" 
            name="rbf" 
            type="checkbox" 
            className="switch"
            onChange={() => {
              setRbf(!rbf)
            }}
            checked={rbf}
          />
        </div>
      </fieldset>
      
      <button
        className="button" 
        type="submit"
        disabled={
          !nfthash ||
          !receiver ||
          !assetGuid
        }
      >
        Mint
      </button>
    </form>
  );
}

export default FormMintNFT;
