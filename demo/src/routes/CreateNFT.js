import { useRef, useState } from "react";
import { useSelector } from "react-redux";
import * as yup from "yup";
import { toast, ToastContainer } from "react-toastify";
import 'react-responsive-modal/styles.css';
import { Modal } from 'react-responsive-modal';

import assetImg from "../images/asset.svg";
import loaderImg from "../images/spinner.svg";
import AdvancedPanel from "../components/AdvancedPanel";
import PreviewFile from "../components/PreviewFile";
import ipfsUpload from "../services/ipfsUpload";

import "react-toastify/dist/ReactToastify.min.css";

export default function CreateNFT() {
  const [symbol, setSymbol] = useState("");
  const [precision, setPrecision] = useState(1);
  const [description, setDescription] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
  const [file, setFile] = useState();
  const [isUploading, setIsUploading] = useState(false);
  const textAreaRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [advancedOptions, setAdvancedOptions] = useState({});
  const controller = useSelector((state) => state.controller);
  const { connectedAccountAddress } = useSelector(
    (state) => state.connectedAccountData
  );

  const dataYup = {
    symbol,
    precision,
    metadataDescription,
  };

  const schema = yup.object().shape({
    symbol: yup.string().required("Symbol is required!"),
    precision: yup.number(0, 1, 2, 3, 4, 5, 6, 7, 8).required(),
    metadataDescription: yup.string().required("Metadata URL is required!"),
  });

  const handleCreateNFT = async (event) => {
    try {
      event.preventDefault();

      await schema.validate(dataYup, { abortEarly: false });

      controller.handleCreateNFT({
        symbol,
        issuer: connectedAccountAddress,
        precision: Number(precision),
        description: metadataDescription,
        ...advancedOptions,
      })
      .catch((err) => {
        toast.dismiss()
        toast.error(err, { position: "bottom-right" });
        
      });

      event.target.reset();
    } catch (error) {
      toast.dismiss()
      toast.error(error.errors[0], { position: "bottom-right" });
    }
  };

  const handleInputFileChange =  async (event) => {
    try {
      const dataIpfs = {
        symbol,
        description,
      };
      const schemaIpfs = yup.object().shape({
        symbol: yup.string().required("Symbol is required to upload"),
        description: yup.string().required("Description is required to upload")
      });
  
      await schemaIpfs.validate(dataIpfs, { abortEarly: false });

      setIsUploading(true);  
      setFile(event.target.files[0]);

      await upload(event.target.files[0]);
      setIsUploading(false);  

    } catch (error) {
      toast.dismiss()
      toast.error(error.errors[0], { position: "bottom-right" });
      
      event.target.value = "";
    }
    
  };

  const handleInputChange = (setState) => {
    return (event) => {
      setState(event.target.value);
    };
  };

  async function upload(file) {
    const { value: { cid: nftHash } } = await ipfsUpload(file);
    const ipfsLink = `https://ipfs.io/ipfs/${nftHash}`;
   
    const metadata = JSON.stringify({
      name: symbol,
      description: description,
      ...(file.type.startsWith("image")
        ? { image: ipfsLink }
        : { animation_url: ipfsLink }),
    });

    const jsonFile = new File([metadata], "metadata.json", {
      type: "application/json",
    });

    const { value: { cid: metaHash } } = await ipfsUpload(jsonFile);

    setMetadataDescription(`https://ipfs.io/ipfs/${metaHash}`);
  }

  function copyToClipboard(e) {
    textAreaRef.current.select();
    document.execCommand("copy");
    e.target.focus();
    toast.dismiss()
    toast.dark("Copied!", { position: "bottom-right", autoClose: 3000 });
    
  }

  const onOpenModal = () => setOpen(true);
  const onCloseModal = () => setOpen(false);

  return (
    <section>
      <div className="inner wider">
        <h1>Create and Issue a NFT (Non-Fungible)</h1>
        <p>This tool helps you create a non-fungible token on Syscoin.</p>
        <p className="c">
          A non-fungible token represents a unique digital asset. Examples
          include a specific piece of art, music, a collectible, a serialized
          gold bar, a land deed or other certificate, or anything else unique.
        </p>
        <p className="c">
          Syscoin gives you the option to make your NFT’s value divisible
          (fractional) on the blockchain. You do this by specifying that the NFT
          will have more than one share. This means more than one person can own
          a portion of the NFT’s value on the blockchain. One share will be
          represented as the smallest unit of precision (decimal place). To
          create a typical non-shared NFT, leave “Shares” set to 1.
        </p>
        <p className="c">
        NOTE: The token creation process does not use Z-DAG;
         creation requires on-chain settlement.
          Each settlement takes approximately 60 seconds.
           SysMint’s entire process for creating a token involves more than one transaction.
            It might take 2 to 5 minutes total before all transactions are settled and your new token is ready.
        </p>
        <p>
          Familiarize yourself with the {" "}
           <span
           className="modalOpen"
           onClick={onOpenModal} >backend process</span>
           {" "} this tool uses, if you
          wish.
          
        </p>
        <Modal open={open} onClose={onCloseModal} center>
        <p className="c">
          SysMint automatically follows this logic to create your non-fungible
          token:
        </p>
        <tbody border="2">
          <tr>
            <td className="tdb"> 1</td>
            <td className="tdc">{"  "} `assetNew` is executed to create your NFT according to the specs
          you provided in the form. Ownership (management) of the asset is
          assigned to you by using a newly derived address within your wallet’s
          current selected account. The asset’s precision is assigned according
          to your “Shares” selection (default 1 share = 0 precision). The URL to
          your digital asset is stored on-chain in your asset’s Description
          field. </td>
          </tr>
          <tr>
          <td className="tdb"> 2</td>
          <td className="tdc">  `assetSend` is executed to issue your NFT into circulation. This
          issues and sends the NFT (always quantity 1) to the same address used
          in Step 1 of this process.</td>
          </tr>
          </tbody>
          <p>{" "}</p> 
        <p className="c">
          This process requires you to approve two transactions in your wallet.
          The first is for creating the NFT, and the second is for issuing it
          into circulation.
        </p>
        </Modal>
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
            <div className="form-group col-50 col-sm-100 sm-spaced-top"></div>
            <div className="form-group col-67 col-xs-100 xs-spaced-top">
              <label htmlFor="shares">
                Total Shares{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <select
                className="form-control"
                id="shares"
                onChange={handleInputChange(setPrecision)}
              >
                <option
                value={0}>1</option>
                <option
                value={1}>10</option>
                <option
                value={2}>100</option>
                <option
                value={3}>1,000</option>
                <option
                value={4}>10,000</option>
                <option
                value={5}>100,000</option>
                <option
                value={6}>1,000,000</option>
                <option
                value={7}>10,000,000</option>
                <option
                value={8}>100,000,000</option>
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
                <input onChange={handleInputFileChange} type="file" id="logo" />
                {!isUploading ? (
                  file ? (
                    <PreviewFile file={file} />
                  ) : (
                    <img src={assetImg} alt="" />
                  )
                ) : (
                  <img src={loaderImg} alt="" />
                )}
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

          <AdvancedPanel
            onChange={setAdvancedOptions}
            toggleButton
            renderIssuerRightsField={false}
          />

          <div className="btn-center">
            <button type="submit">Create Token</button>
          </div>
        </form>
      </div>
    </section>
  );
}
