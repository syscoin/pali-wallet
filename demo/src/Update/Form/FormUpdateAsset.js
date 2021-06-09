import React, { useState, useEffect } from "react";

const FormUpdateAsset = (props) => {
  const [assetGuid, setAssetGuid] = useState('');
  const [receiver, setReceiver] = useState('');
  const [contract, setContract] = useState('');
  const [whiteList, setWhiteList] = useState(null);
  const [notarykeyid, setNotaryKeyId] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [instanttransfers, setInstantTransfers] = useState(false);
  const [hdrequired, setHdrequired] = useState(false);
  const [auxFeeKeyId, setAuxFeeKeyId] = useState(0);
  const [auxFeeDetails, setAuxFeeDetails] = useState({
    auxfeekeyid: '',
    auxfees: [
      {
        bound: 0,
        percent: 0
      }
    ]
  });
  const [bound, setBound] = useState(0);
  const [percent, setPercent] = useState(0);
  const [description, setDescription] = useState('');
  const [supply, setSupply] = useState('');
  const [capabilityFlags, setCapabilityFlags] = useState(127);
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
        contract,
        capabilityFlags,
        receiver,
        description,
        supply,
        endpoint,
        instanttransfers,
        hdrequired,
        auxFeeDetails,
        notarykeyid
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
              onChange={(event) => setAssetGuid(event.target.value)}
            >
              <option>Choose...</option>
              <RenderAsset />
            </select>
          </div>

          <label htmlFor="contract">ETH Contract Address:</label>
          <input 
            className="input" 
            type="text" 
            id="contract" 
            name="contract"
            onBlur={(event) => setContract(event.target.value)}
          />

          <label htmlFor="capabilityflags">Capability Flags:</label>
          <input 
            className="input" 
            type="number" 
            id="capabilityflags" 
            name="capabilityflags"
            onBlur={(event) => setCapabilityFlags(Number(event.target.value))}
            required
          />

          <label htmlFor="contract">Description:</label>
          <input 
            className="input" 
            type="text" 
            id="description" 
            name="description"
            onBlur={(event) => setDescription(event.target.value)}
            required
          />

          <label htmlFor="supply">Supply:</label>
          <input 
            className="input" 
            type="number" 
            id="supply" 
            name="supply"
            onBlur={(event) => setSupply(event.target.value)}
          />

          <label htmlFor="receiver">Receiver:</label>
          <input 
            className="input" 
            type="text" 
            id="receiver" 
            name="receiver"
            onBlur={(event) => setReceiver(event.target.value)}
          />

          <label htmlFor="notarykeyid">Notary key id:</label>
          <input 
            className="input" 
            type="text" 
            id="notarykeyid" 
            name="notarykeyid"
            onBlur={(event) => setNotaryKeyId(event.target.value)}
          />

          <label htmlFor="endpoint">Endpoint:</label>
          <input 
            className="input" 
            type="text" 
            id="endpoint" 
            name="endpoint"
            onBlur={(event) => setNotaryKeyId(event.target.value)}
          />

          <label htmlFor="instantTransfers">Instant transfers:</label>
          <input 
            className="input" 
            type="checkbox" 
            id="instantTransfers" 
            name="instantTransfers"
            onBlur={(event) => setInstantTransfers(event.target.value)}
          />

          <label htmlFor="instantTransfers">hdrequired</label>
          <input 
            className="input" 
            type="checkbox" 
            id="instantTransfers" 
            name="instantTransfers"
            onBlur={(event) => setInstantTransfers(event.target.value)}
          />

          <label htmlFor="auxFeeKeyId">Aux Fee Key ID</label>
          <input 
            className="input" 
            type="text" 
            id="auxFeeKeyId"
            name="auxFeeKeyId"
            onBlur={(event) => setAuxFeeDetails({
              ...auxFeeDetails.auxfees,
              auxfeekeyid: event.target.value
            })}
          />

          <label htmlFor="bound">Bound</label>
          <input 
            className="input" 
            type="number" 
            id="bound" 
            name="bound"
            onBlur={(event) => setAuxFeeDetails({
              ...auxFeeDetails,
              auxfees: {
                ...auxFeeDetails.auxfees,
                bound: Number(event.target.value),
              }
            })}
          />

          <label htmlFor="percent">Percent</label>
          <input 
            className="input" 
            type="number" 
            id="percent" 
            name="percent"
            onBlur={(event) => setAuxFeeDetails({
              ...auxFeeDetails,
              auxfees: {
                ...auxFeeDetails.auxfees,
                percent: Number(event.target.value),
              }
            })}
          />
        </div>
      </fieldset>
      
      <button
        className="button" 
        type="submit"
        disabled={
          !assetGuid ||
          !description
        }

        onClick={() => console.log('asset guid', assetGuid)}
      >
        Mint
      </button>
    </form>
  );
}

export default FormUpdateAsset;
