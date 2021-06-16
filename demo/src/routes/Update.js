import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

import assetImg from "../images/asset.svg";

export default function Update() {
  const controller = useSelector((state) => state.controller);
  const [tokens, setTokens] = useState([]);
  const [file, setFile] = useState();

  const [assetGuid, setAssetGuid] = useState();
  const [description, setDescription] = useState("");
  const [contract, setContract] = useState("");
  const [capabilityFlags, setCapabilityFlags] = useState(0);
  const [endpoint, setEndpoint] = useState();
  const [instanttransfers, setInstantTransfers] = useState(false);
  const [hdrequired, setHDRequired] = useState(false);
  const [auxfeekeyid, setAuxFeeKeyID] = useState();
  const [auxfees, setAuxFees] = useState([]);
  const [notaryAddress, setNotaryAddress] = useState();

  useEffect(() => {
    controller &&
      controller.getUserMintedTokens().then((data) => {
        data && setTokens(data);
      });

    return () => setTokens([]);
  }, []);

  const handleUpdateToken = (event) => {
    event.preventDefault();

    controller &&
      controller.handleUpdateToken(
        assetGuid,
        contract,
        capabilityFlags || 127,
        description,
        { endpoint, instanttransfers, hdrequired },
        { auxfeekeyid, auxfees },
        notaryAddress
      );
  };

  const handleCapabilityFlags = (event) => {
    const value = Number(event.target.value);
    const isChecked = event.target.checked;

    setCapabilityFlags((prevValue) => {
      return isChecked ? prevValue + value : prevValue - value;
    });
  };

  const handleInputChange = (setState) => {
    return (event) => {
      const target = event.target;

      target.type !== "checkbox"
        ? setState(target.value)
        : setState(target.checked);
    };
  };

  const handleInputFile = (setState) => {
    return async (event) => {
      const _file = event.target.files[0];

      setState(_file);

      // upload image
    };
  };

  const handleAddFee = (event) => {
    event.preventDefault();

    const bound = document.querySelector("#bound");
    const percent = document.querySelector("#percent");

    if (!bound.value || !percent.value) return;

    if ([bound.value, percent.value].some((v) => isNaN(Number(v)))) {
      bound.value = "";
      percent.value = "";

      return;
    }

    setAuxFees([...auxfees, { bound: bound.value, percent: percent.value }]);

    bound.value = "";
    percent.value = "";
  };

  const handleRemoveFee = (fee) => {
    return function (event) {
      event.preventDefault();

      const newAuxFees = auxfees.filter((f) => f !== fee);

      setAuxFees(newAuxFees);
    };
  };

  return (
    <section>
      <div className="inner wider">
        <h1>Update Token Specifications</h1>
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus quam
          ex, suscipit sagittis orci tincidunt, maximus posuere dui. Morbi porta
          magna hendrerit velit molestie ultricies. Sed a tellus est. Quisque ut
          velit quis orci rutrum congue ut euismod odio. Nunc non ipsum lacus.
          Pellentesque at urna sed arcu ultricies fringilla sit amet a purus.
        </p>
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus quam
          ex, suscipit sagittis orci tincidunt, maximus posuere dui. Morbi porta
          magna hendrerit velit molestie ultricies. Sed a tellus est. Quisque ut
          velit quis orci rutrum congue ut euismod odio. Nunc non ipsum lacus.
          Pellentesque at urna sed arcu ultricies fringilla sit amet a purus.
        </p>

        <form onSubmit={handleUpdateToken}>
          <div className="row">
            <div className="spacer col-100"></div>
          </div>

          <div className="form-line">
            <div className="form-group col-100">
              <label htmlFor="token">Token</label>
              <select
                onChange={handleInputChange(setAssetGuid)}
                className="form-control"
                id="token"
              >
                <option></option>
                {tokens.map((token) => (
                  <option value={token.assetGuid} key={token.assetGuid}>
                    {token.assetGuid} - {token.symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-line">
            <div className="form-group col-67 col-md-50 col-sm-100">
              <label htmlFor="description">
                Description{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <textarea
                onChange={handleInputChange(setDescription)}
                className="form-control"
                id="description"
                rows="4"
              ></textarea>
              <p className="help-block">Max length: 256 bytes</p>
            </div>
            <div className="form-group col-33 col-md-50 col-sm-100">
              <div className="fileupload">
                <label htmlFor="logo">Upload logo</label>
                <input
                  onChange={handleInputFile(setFile)}
                  type="file"
                  id="logo"
                />
                <img src={file ? URL.createObjectURL(file) : assetImg} />
              </div>
            </div>
          </div>

          <div className="form-line gray">
            <div className="advanced-panel open">
              <div className="form-line">
                <div className="label-spacing">
                  <label>Compliance & Business Rulesets</label>
                </div>
                <div className="form-group col-50 spaced col-sm-100">
                  <label htmlFor="signer">
                    Signer Address *{" "}
                    <i className="icon-info-circled" title="help goes here"></i>
                  </label>
                  <input
                    onChange={handleInputChange(setNotaryAddress)}
                    type="text"
                    className="form-control"
                    id="signer"
                    placeholder=""
                  />
                  <p className="help-block">
                    Address that will notarize transactions
                  </p>
                </div>
                <div className="form-group col-50 spaced col-sm-100">
                  <label htmlFor="endpointurl">
                    Endpoint URL *{" "}
                    <i className="icon-info-circled" title="help goes here"></i>
                  </label>
                  <input
                    onChange={handleInputChange(setEndpoint)}
                    type="text"
                    className="form-control"
                    id="endpointurl"
                    placeholder=""
                  />
                  <p className="help-block">URL to your notray API</p>
                </div>
                <div className="form-group col-100">
                  <div className="checkbox small">
                    <label>
                      <input
                        onChange={handleInputChange(setInstantTransfers)}
                        type="checkbox"
                      />
                      Notary provides double-spend protection and guarantees
                      safe instant transfers (Default: OFF)
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input
                        onChange={handleInputChange(setHDRequired)}
                        type="checkbox"
                      />{" "}
                      HD required for asset transfers (all senders must supply
                      their XPUB & HD Path) (Default: OFF)
                    </label>
                  </div>
                </div>
              </div>

              <div className="form-line half">
                <div className="form-group col-100">
                  <div className="label-spacing">
                    <label>Issuer Rights</label>
                  </div>
                </div>
                <div className="form-group col-100">
                  <div className="checkbox small">
                    <label>
                      <input
                        onChange={handleCapabilityFlags}
                        type="checkbox"
                        value={4}
                      />
                      Issue supply into circulation (LOCKED - ALWAYS ON)
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input
                        onChange={handleCapabilityFlags}
                        type="checkbox"
                        value={1}
                      />
                      Edit field value: [public_value]
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input
                        onChange={handleCapabilityFlags}
                        type="checkbox"
                        value={2}
                      />
                      Edit field value: [contract]
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input
                        onChange={handleCapabilityFlags}
                        type="checkbox"
                        value={8}
                      />
                      Edit field value: [notary_address]
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input
                        onChange={handleCapabilityFlags}
                        type="checkbox"
                        value={16}
                      />
                      Edit field value: [notary_details]
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input
                        onChange={handleCapabilityFlags}
                        type="checkbox"
                        value={32}
                      />
                      Edit field value: [auxfee]
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input
                        onChange={handleCapabilityFlags}
                        type="checkbox"
                        value={64}
                      />
                      Edit field value: [capability_flags]
                    </label>
                  </div>
                </div>
              </div>

              <div className="form-line half right">
                <div className="form-group col-100">
                  <div className="label-spacing">
                    <label>Auxiliary Fees</label>
                  </div>
                </div>
                <div className="form-group col-100 spaced">
                  <label htmlFor="payout">
                    Payout Address *{" "}
                    <i className="icon-info-circled" title="help goes here"></i>
                  </label>
                  <input
                    onChange={handleInputChange(setAuxFeeKeyID)}
                    type="text"
                    className="form-control"
                    id="payout"
                    placeholder=""
                  />
                </div>
                <div className="form-group col-100">
                  <div className="row nested">
                    <div className="form-group col-40">
                      <p className="help-block">Bound</p>
                    </div>
                    <div className="form-group col-40">
                      <p className="help-block">Percent</p>
                    </div>
                  </div>
                  {auxfees.map((fee, i) => (
                    <div className="row nested" key={i}>
                      <div className="form-group col-40">
                        <input
                          value={fee.bound}
                          disabled
                          type="text"
                          className="form-control"
                        />
                      </div>
                      <div className="form-group col-40">
                        <input
                          value={fee.percent}
                          disabled
                          type="text"
                          className="form-control"
                        />
                      </div>
                      <div className="form-group col-20">
                        <button
                          className="small"
                          onClick={handleRemoveFee(fee)}
                        >
                          <i className="icon-cancel"></i>
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="row nested">
                    <div className="form-group col-40">
                      <input type="text" className="form-control" id="bound" />
                    </div>
                    <div className="form-group col-40">
                      <input
                        type="text"
                        className="form-control"
                        id="percent"
                      />
                    </div>
                    <div className="form-group col-20">
                      <button className="small" onClick={handleAddFee}>
                        <i className="icon-plus"></i>
                      </button>
                    </div>
                  </div>

                  <div className="row nested">
                    <div className="col-100">
                      <p className="help-block">
                        At least one Bound | Percent pair is required
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="form-line spaced-top">
                <div className="form-group col-100">
                  <label htmlFor="contract">
                    Contract{" "}
                    <i className="icon-info-circled" title="help goes here"></i>
                  </label>
                  <input
                    onChange={handleInputChange(setContract)}
                    type="text"
                    className="form-control"
                    id="contract"
                    placeholder=""
                  />
                  <p className="help-block">
                    ERC-20 Contract linked to this token via Syscoin Bridge
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="btn-center">
            <button>Update Token</button>
          </div>
        </form>
      </div>
    </section>
  );
}
