import { useState } from "react";
import { useSelector } from "react-redux";
import * as yup from "yup";
import { toast, ToastContainer } from "react-toastify";
import 'react-responsive-modal/styles.css';
import { Modal } from 'react-responsive-modal';

import AdvancedPanel from "../components/AdvancedPanel";
import { uploadLogo } from "../services/logoService";
import assetImg from "../images/asset.svg";
import loaderImg from "../images/spinner.svg";

import "react-toastify/dist/ReactToastify.min.css";

export default function CreateSPT() {
  const [precision, setPrecision] = useState(8);
  const [maxSupply, setMaxSupply] = useState(1);
  const [description, setDescription] = useState("");
  const [symbol, setSymbol] = useState("");
  const [receiver, setReceiver] = useState("");
  const [initialSupply, setInitialSupply] = useState(0);
  const [issueSupplyIntoCirculation, setIssueSupplyIntoCirculation] = useState(false);
  const [file, setFile] = useState();
  const [isUploading, setIsUploading] = useState(false);
  const [advancedOptions, setAdvancedOptions] = useState({});
  const [open, setOpen] = useState(false);
  const controller = useSelector((state) => state.controller);
  const { connectedAccountAddress } = useSelector(
    (state) => state.connectedAccountData
  );

  const dataYup = {
    precision,
    symbol,
    maxSupply,
    description,
    receiver,
  };

  const schema = yup.object().shape({
    precision: yup.number().required(),
    symbol: yup.string().required("Symbol is required!"),
    maxSupply: yup.number().required(),
    receiver: yup.string(),
  });

  const handleCreateToken = async (event) => {
    try {      
      event.preventDefault();

      await schema.validate(dataYup, { abortEarly: false });

      if (
        await controller.isValidSYSAddress(receiver || connectedAccountAddress)
      ) {
        if( maxSupply < initialSupply){
          toast.error("Max supply must be greater than initial supply", { position: "bottom-right" });
          return;
        }
        controller
          .handleCreateToken({
            precision: Number(precision),
            symbol,
            maxsupply: Number(maxSupply),
            description,
            receiver: receiver || connectedAccountAddress,
            initialSupply: Number(initialSupply),
            ...advancedOptions,
          }).then(async (tx) => {
            console.log('tx response wallet', tx)

            // if(file) {
            //   setIsUploading(true);
            //   await uploadLogo(tx.transactionData.tokenTransfers[1].token, file);
                
            //   setIsUploading(false);
            //   event.target.reset();
            // }
          })
          .catch((err) => {
            toast.dismiss()
            toast.error(err, { position: "bottom-right" });
            event.target.reset();
          });

        return;
      }
      toast.dismiss()
      toast.error("Invalid Address", { position: "bottom-right" });
    } catch (error) {
      toast.dismiss()
      toast.error(error.errors[0], { position: "bottom-right" });
    }
  };

  const handleInputChange = (setState) => {
    return (event) => {
      setState(event.target.value);
    };
  };

  const handleInputFileChange = async (event) => {
    const _file = event.target.files[0];

    if (!_file) return;

    if (!["image/jpg", "image/png", "image/jpeg"].includes(_file.type)) {
      toast.dark(
        `File type ${_file.type} is not supported, just .jpg and .png files`,
        { position: "bottom-right" }
        
      );
 
      event.target.value = "";
      return;
    }

    setFile(_file);
  };

  const handleInitialSupply = (isActive) => {
    if(isActive) {
      setInitialSupply(0);
      setIssueSupplyIntoCirculation(isActive);
    } else {
      setIssueSupplyIntoCirculation(isActive);
    }
  }

  const onOpenModal = () => setOpen(true);
  const onCloseModal = () => setOpen(false);

  return (
    <section>
      <div className="inner wider">
        <h1>Create a Standard Token (Fungible)</h1>
        <p>This tool helps you create a fungible token on Syscoin.</p>
        <p className="c">
          A fungible token can be interchanged with other individual goods or
          assets of the same type. Each unit of a fungible token has the same
          value, and one coin of the asset is not distinguishable from another.
          Examples: SYS, BTC, stablecoins tokens like AUX and USDT, and
          currencies in general.
        </p>
        <p className="c">
        NOTE: The token creation process does not use Z-DAG; creation requires 
        on-chain settlement. Each settlement takes approximately 60 seconds. 
        SysMint’s entire process for creating a token involves more than one 
        transaction. It might take 2 to 5 minutes total before all transactions
        are settled and your new token is ready.
        </p>
        <p className="c">
          Familiarize yourself with the{" "}
           <span
           className="modalOpen"
           onClick={onOpenModal} >backend process</span>
           {" "} this tool uses, if you
          wish.
        </p>
        <Modal open={open} onClose={onCloseModal} center>
        <p className="c">
          SysMint automatically follows this logic to create your fungible
          token:
        </p>
        
        <tbody border="2">
          <tr>
            <td className="tdb"> 1</td>
            <td className="tdc">{"  "} `assetNew` is executed to create your 
          token according to the specs
          you provided in the form. Ownership (management) of the asset is
          assigned to you by using a newly derived address within your wallet’s
          current selected account. </td>
          </tr>
          <tr>
          <td className="tdb"> 2</td>
          <td className="tdc">  Once the transaction from step 1 settles onchain, `assetSend` is
          then executed to mint the quantity of tokens you specified in the
          field “Initial Circulating Supply”. These tokens are sent to the same
          address derived in step 1. If you left this field 0 (zero), this step
          is skipped.</td>
          </tr>
          </tbody>
        <p>{" "}</p> 
        <p className="c">
          This process requires you to approve up to two transactions in your
          wallet. The first is for creating the asset, and the second is for
          issuing the initial quantity of tokens into circulation if you
          specified an “Initial Circulating Supply” greater than zero.
        </p>



        </Modal>
        <form onSubmit={handleCreateToken}>
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
                autoComplete="off"
              />
              <p className="help-block">Max length: 8 alpha-numeric</p>
            </div>
            <div className="form-group col-67 col-xs-100 xs-spaced-top">
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
          </div>

          <div className="form-line gray">
            <div className="form-group col-33 col-lg-50 col-xs-100">
              <label htmlFor="precision">
                Precision{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                onChange={handleInputChange(setPrecision)}
                type="range"
                id="precision"
                name="points"
                min="0"
                max="8"
                value={precision}
              />
              <p className="help-block">{precision} - 8 (default 8)</p>
            </div>
            <div className="form-group col-33 col-lg-50 col-xs-100 xs-spaced-top">
              <label htmlFor="supply">
                Max supply{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                onChange={handleInputChange(setMaxSupply)}
                type="number"
                className="form-control"
                id="supply"
                placeholder=""
                autoComplete="off"
              />
              <p className="help-block">Ceiling: (default 1)</p>
            </div>

            <div className="form-group col-33 col-lg-100 lg-spaced-top">
              <label htmlFor="initialsupply">
                Initial Circulating Supply{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                onChange={handleInputChange(setInitialSupply)}
                type="number"
                value={initialSupply}
                className="form-control"
                id="initialsupply"
                autoComplete="off"
                disabled={
                  (receiver && receiver !== connectedAccountAddress) ||
                  issueSupplyIntoCirculation 
                }
                placeholder={
                  receiver && receiver !== connectedAccountAddress
                    ? "You can only create a initial circulating supply for SPTs that you're the owner"
                    : ""
                }
              />
 
              <p className="help-block">
                Ceiling: Max Supply. This value will be minted and sent to the
                issuer/owner address for further distribution.{" "}
              </p>
            </div>
          </div>

          <div className="form-line">
            <div className="form-group col-67 col-md-50 col-sm-100">
              <label htmlFor="description">
                Description{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                onChange={handleInputChange(setDescription)}
                className="form-control"
                type="text"
                id="description"
                name="description"
                autoComplete="off"
              />

              <p className="help-block">Max length: 256 bytes</p>
            </div>
            <div className="form-group col-33 col-md-50 col-sm-100">
              <div className="fileupload">
                <label htmlFor="logo">Upload logo</label>
                <input onChange={handleInputFileChange} type="file" id="logo" />
                {!isUploading ? (
                  file ? (
                    <img src={URL.createObjectURL(file)} alt="" />
                  ) : (
                    <img src={assetImg} alt="" />
                  )
                ) : (
                  <img src={loaderImg} alt="" />
                )}
               
              </div>
            </div>
          </div>

          <AdvancedPanel
            onChange={setAdvancedOptions}
            toggleButton
            onIssueSupplyIntoCirculationChange={handleInitialSupply}
          />

          <div className="btn-center">
            <button>Create Token</button>
          </div>
        </form>
      </div>
    </section>
  );
}
 