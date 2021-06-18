import React, { useRef, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { NFTStorage, File } from "nft.storage";

import assetImg from "../images/asset.svg";
import loaderImg from "../images/spinner.svg";
import { token } from "../config";
import { elementEventHandler } from "../utils/elementEventHandler";

export default function CreateNFT() {
  const [symbol, setSymbol] = useState("");
  const [maxSupply, setMaxSupply] = useState(1);
  const [description, setDescription] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
  const [receiver, setReceiver] = useState("");
  const [file, setFile] = useState();
  const [isUploading, setIsUploading] = useState(false);
  const controller = useSelector((state) => state.controller);
  const [copySuccess, setCopySuccess] = useState('');
  const textAreaRef = useRef(null);
  const { connectedAccountAddress } = useSelector(
    (state) => state.connectedAccountData
  );

  useEffect(() => {
    connectedAccountAddress && setReceiver(connectedAccountAddress);
  }, [connectedAccountAddress]);

  useEffect(() => {
    const advanced = document.querySelector(".advanced");
    const advancedPanel = document.querySelector(".advanced-panel");

    elementEventHandler(["click"], "", function () {
      this.classList.toggle("open");
      advancedPanel.classList.toggle("open");
    })(advanced);
  }, []);

  const handleCreateNFT = async (event) => {
    event.preventDefault();
  };

  const handleInputChange = (setState) => {
    return (event) => {
      setState(event.target.value);
    };
  };

  const handleInputFile = async (event) => {
    const client = new NFTStorage({ token });
    const _file = event.target.files[0];

    if (!["image/jpg", "image/png", "image/jpeg"].includes(_file.type)) {
      //notify the user that the file type is not supported

      return;
    }

    setFile(_file);
    setIsUploading(true);

    const metadata = await client.store({
      name: symbol,
      description,
      image: new File([_file], _file.name, { type: _file.type }),
    });

    setIsUploading(false);
    setMetadataDescription(
      `https://ipfs.io/ipfs/${metadata.ipnft}/metadata.json`
    )
  };

  function copyToClipboard(e) {
    textAreaRef.current.select();
    document.execCommand('copy');
    e.target.focus();
    setCopySuccess('Copied!');
  };


  return (
    <section>
      <div className="inner wider">
        <h1>Create and Issue a NFT (Non-Fungible)</h1>
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

        <form onSubmit={handleCreateNFT}>
          <div className="row">
            <div className="spacer col-100"></div>
          </div>

          <div className="form-line">
            <div className="form-group col-25 col-md-50 col-sm-100">
              <label htmlFor="symbol">
                Symbol{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                onChange={handleInputChange(setSymbol)}
                type="text"
                className="form-control"
                id="symbol"
                placeholder=""
              />
              <p className="help-block">Max length: 8 alpha-numeric</p>
            </div>
            <div className="form-group col-50 col-md-50 col-sm-100 sm-spaced-top">
              <label htmlFor="owneraddr">
                Issuer/Owner Address{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                onChange={handleInputChange(setReceiver)}
                type="text"
                className="form-control"
                id="owneraddr"
                placeholder=""
              />
              <p className="help-block">
                Optional: If blank, the token will be assigned to new address in
                your connected wallet
              </p>
            </div>
            <div className="form-group col-25 col-md-100 md-spaced-top">
              <label htmlFor="shares">
                Total Shares{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <select
                className="form-control"
                id="shares"
                onChange={handleInputChange(setMaxSupply)}
              >
                <option>1</option>
                <option>2</option>
                <option>3</option>
              </select>
              <p className="help-block">Default 1</p>
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
                value={description}
                className="form-control"
                id="description"
                rows="4"
              ></textarea>
              <p className="help-block">Max length: 256 bytes</p>
            </div>
            <div className="form-group col-33 col-md-50 col-sm-100">
              <div className="fileupload">
                <label htmlFor="logo">Upload logo</label>
                <input onChange={handleInputFile} type="file" id="logo" />
                <img
                  src={
                    !isUploading
                      ? file
                        ? URL.createObjectURL(file)
                        : assetImg
                      : loaderImg
                  }
                />
              </div>
            </div>
          </div>

          <div className="form-line">
            <div className="form-group col-67 col-md-50 col-sm-100">
                <label htmlFor="owneraddr">
                Metadata url{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                value={metadataDescription}
                type="url"
                className="form-control"
                id="metadataDescription"
                placeholder=""
                ref={textAreaRef}
              /> 
            </div>
            <div className="form-group col-33 col-md-50 col-sm-100">
            <div className="fileupload">
                  {
       /* Logical shortcut for only displaying the 
          button if the copy command exists */
       document.queryCommandSupported('copy') &&
        <div>
          <button 
          className="copy"
          onClick={copyToClipboard}>Copy</button> 
          {copySuccess}
        </div>
      }
            </div>
          </div>
          </div>
          <div className="form-line">
            <div className="form-group col-67 col-md-50 col-sm-100">
             
              
            <div className="form-group col-25 col-md-100 md-spaced-top">
              <div className="fileupload">
                 
      </div>
            </div></div>
          </div>

          <div className="form-line gray">
            <div className="form-group col-100">
              <div className="advanced">
                Advanced <i className="icon-right-open"></i>
                <i className="icon-down-open"></i>
              </div>
            </div>
            <div className="advanced-panel">
              <div className="form-line">
                <div className="form-group col-100">
                  <div className="checkbox">
                    <label>
                      <input onChange={() => {}} type="checkbox" /> Notary
                      (Compliance & Busiess Rulesets)
                    </label>
                  </div>
                </div>
                <div className="form-group col-50 spaced col-sm-100">
                  <label htmlFor="signer">
                    Signer Address *{" "}
                    <i className="icon-info-circled" title="help goes here"></i>
                  </label>
                  <input
                    onChange={() => {}}
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
                    onChange={() => {}}
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
                      <input onChange={() => {}} type="checkbox" />
                      Notary provides double-spend protection and guarantees
                      safe instant transfers (Default: OFF)
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input onChange={() => {}} type="checkbox" /> HD required
                      for asset transfers (all senders must supply their XPUB &
                      HD Path) (Default: OFF)
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
                      <input onChange={() => {}} type="checkbox" />
                      Issue supply into circulation (LOCKED - ALWAYS ON)
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input onChange={() => {}} type="checkbox" />
                      Edit field value: [public_value]
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input onChange={() => {}} type="checkbox" />
                      Edit field value: [contract]
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input onChange={() => {}} type="checkbox" />
                      Edit field value: [notary_address]
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input onChange={() => {}} type="checkbox" />
                      Edit field value: [notary_details]
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input onChange={() => {}} type="checkbox" />
                      Edit field value: [auxfee]
                    </label>
                  </div>
                  <div className="checkbox small">
                    <label>
                      <input onChange={() => {}} type="checkbox" />
                      Edit field value: [capability_flags]
                    </label>
                  </div>
                </div>
              </div>
              <div className="form-line half right">
                <div className="form-group col-100">
                  <div className="checkbox">
                    <label>
                      <input onChange={() => {}} type="checkbox" />
                      Auxiliary Fees
                    </label>
                  </div>
                </div>
                <div className="form-group col-100 spaced">
                  <label htmlFor="payout">
                    Payout Address *{" "}
                    <i className="icon-info-circled" title="help goes here"></i>
                  </label>
                  <input
                    onChange={() => {}}
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
                  <div className="row nested">
                    <div className="form-group col-40">
                      <input
                        onChange={() => {}}
                        type="text"
                        className="form-control"
                        placeholder=""
                      />
                    </div>
                    <div className="form-group col-40">
                      <input
                        onChange={() => {}}
                        type="text"
                        className="form-control"
                        placeholder=""
                      />
                    </div>
                    <div className="form-group col-20">
                      <button className="small">
                        <i className="icon-cancel"></i>
                      </button>
                    </div>
                  </div>

                  <div className="row nested">
                    <div className="form-group col-40">
                      <input
                        onChange={() => {}}
                        type="text"
                        className="form-control"
                        placeholder=""
                      />
                    </div>
                    <div className="form-group col-40">
                      <input
                        onChange={() => {}}
                        type="text"
                        className="form-control"
                        placeholder=""
                      />
                    </div>
                    <div className="form-group col-20">
                      <button className="small">
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
            </div>
          </div>

          <div className="btn-center">
            <button>Create Token</button>
          </div>
        </form>
      </div>
    </section>
  );
}
