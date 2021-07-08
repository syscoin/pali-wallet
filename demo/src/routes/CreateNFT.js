import React, { useRef, useState, useEffect } from "react";
import { useSelector } from "react-redux";
import * as yup from "yup";
import assetImg from "../images/asset.svg";
import loaderImg from "../images/spinner.svg";
import { token } from "../config";
import AdvancedPanel from "../components/AdvancedPanel";
import PreviewFile from "../components/PreviewFile";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.min.css";
import ipfsUpload from "../utils/ipfsUpload";

export default function CreateNFT() {
  const [symbol, setSymbol] = useState("");
  const [totalShares, setTotalShares] = useState(1);
  const [description, setDescription] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
  const [issuer, setIssuer] = useState("");
  const [file, setFile] = useState();
  const [isUploading, setIsUploading] = useState(false);
  const [copySuccess, setCopySuccess] = useState("");
  const textAreaRef = useRef(null);
  const [advancedOptions, setAdvancedOptions] = useState({});
  const [error, setError] = useState("");
  const controller = useSelector((state) => state.controller);
  const { connectedAccountAddress } = useSelector(
    (state) => state.connectedAccountData
  );

  const dataYup = {
    symbol,
    issuer,
    totalShares,
    metadataDescription,
  };

  const schema = yup.object().shape({
    symbol: yup.string().required("Symbol is required!"),
    totalShares: yup.number(0,1,2,3,4,5,6,7,8).required(),
    metadataDescription: yup.string().required("Metadata URL is required!"),
    issuer: yup.string(),
  });

  const handleCreateNFT = async (event) => {
    event.preventDefault();

    await schema
      .validate(dataYup, { abortEarly: false })
      .then(async () => {
        if (
          await controller.isValidSYSAddress(issuer || connectedAccountAddress)
        ) {
          controller
            .handleCreateNFT({
              symbol,
              issuer: issuer || connectedAccountAddress,
              totalShares: Number(totalShares),
              description,
              ...advancedOptions         
            })
            .catch((err) => {
              toast.error(err, {position: "bottom-right"});
            });
          event.target.reset();
          return;
        }
        toast.error("Invalid Address", {position: "bottom-right"});
      })
      .catch((err) => {
        err.errors.forEach((error) => {
          toast.error(error, {position: "bottom-right"});
        });
      });
  };

  const handleInputChange = (setState) => {
    return (event) => {
      setState(event.target.value);
    };
  };

  async function upload(file) {
    const dataIpfs = {
      symbol,
    };
    const schemaIpfs = yup.object().shape({
      symbol: yup.string().required("Symbol is required, upload again!"),
    });

    await schemaIpfs
      .validate(dataIpfs, { abortEarly: false })
      .then(async () => {
        const fileData = await ipfsUpload(file);

        const metadata = JSON.stringify({
          name: symbol,
          description: description,
          file: `https://ipfs.io/ipfs/${fileData.value.cid}`,
        });

        const jsonFile = new File([metadata], "metadata.json", {
          type: "application/json",
        });

        const metaData = await ipfsUpload(jsonFile);

        setMetadataDescription(`https://ipfs.io/ipfs/${metaData.value.cid}`);
      })
      .catch((err) => {
        err.errors.forEach((error) => {
          toast.error(error, {position: "bottom-right"});
        });
      });
  }

  useEffect(() => {
    file && upload(file);
  }, [file]);

  function copyToClipboard(e) {
    textAreaRef.current.select();
    document.execCommand("copy");
    e.target.focus();
    toast.dark("Copied!", {position: "bottom-right", autoClose: 3000,});
  }

  return (
    <section>
      <div className="inner wider">
        <h1>Create and Issue a NFT (Non-Fungible)</h1>
        <p>This tool helps you create a non-fungible token on Syscoin.</p>
        <p>A non-fungible token represents a unique digital asset. Examples include a specific piece of art, music, a collectible, a serialized gold bar, a land deed or other certificate, or anything else unique.</p>
        <p>Syscoin gives you the option to make your NFT’s value divisible (fractional) on the blockchain. You do this by specifying that the NFT will have more than one share. This means more than one person can own a portion of the NFT’s value on the blockchain. One share will be represented as the smallest unit of precision (decimal place). To create a typical non-shared NFT, leave “Shares” set to 1.</p>
        <p>Familiarize yourself with the backend process this tool uses, if you wish.(backend process)</p>
        <p>SysMint automatically follows this logic to create your non-fungible token:</p>
        <p>1. `assetNew` is executed to create your NFT according to the specs you provided in the form. Ownership (management) of the asset is assigned to you by using a newly derived address within your wallet’s current selected account. The asset’s precision is assigned according to your “Shares” selection (default 1 share = 0 precision). The URL to your digital asset is stored on-chain in your asset’s Description field.</p>
        <p>2. `assetSend` is executed to issue your NFT into circulation. This issues and sends the NFT (always quantity 1) to the same address used in Step 1 of this process.</p>
        <p>This process requires you to approve two transactions in your wallet. The first is for creating the NFT, and the second is for issuing it into circulation.</p>
        <form onSubmit={handleCreateNFT}>
          <div className="row">
            <div className="spacer col-100"></div>
          </div>
          <ToastContainer />
          <div className="form-line">
            <div className="form-group col-33 col-xs-100">
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
            <div className="form-group col-50 col-sm-100 sm-spaced-top">
   
            </div>
            <div className="form-group col-67 col-xs-100 xs-spaced-top">
              <label htmlFor="shares">
                Total Shares{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <select
                className="form-control"
                id="shares"
                onChange={handleInputChange(setTotalShares)}
              >
                <option>0</option>
                <option>1</option>
                <option>2</option>
                <option>3</option>
                <option>4</option>
                <option>5</option>
                <option>6</option>
                <option>7</option>
                <option>8</option>
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
                <label htmlFor="logo">Upload to IPFS</label>
                <input
                  onChange={(e) => setFile(e.target.files[0])}
                  type="file"
                  id="logo"
                />
                {!isUploading ? (
                  file ? (
                    <PreviewFile file={file} />
                  ) : (
                    <img src={assetImg} alt="" />
                  )
                ) : (
                  <img src={loaderImg} alt="" />
                )}
                <p className="help-block-2">{error}</p>
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
                defaultValue={metadataDescription}
                type="url"
                className="form-control"
                id="metadataDescription"
                readOnly
                ref={textAreaRef}
              />
            </div>
            <div className="form-group col-33 col-md-50 col-sm-100">
              <div className="fileupload">
                {document.queryCommandSupported("copy") && (
                  <div>
                    <button
                      className="copy"
                      onClick={copyToClipboard}
                      type="button"
                    >
                      Copy
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="form-line">
            <div className="form-group col-67 col-md-50 col-sm-100">
              <div className="form-group col-25 col-md-100 md-spaced-top">
                <div className="fileupload"></div>
              </div>
            </div>
          </div>

          <AdvancedPanel onChange={setAdvancedOptions} toggleButton />

          <div className="btn-center">
            <button type="submit">Create Token</button>
          </div>
        </form>
      </div>
    </section>
  );
}
