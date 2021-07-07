import { useState } from "react";
import { useSelector } from "react-redux";
import * as yup from "yup";
import { toast, ToastContainer } from "react-toastify";

import AdvancedPanel from "../components/AdvancedPanel";
import assetImg from "../images/asset.svg";
import "react-toastify/dist/ReactToastify.min.css";

export default function CreateSPT() {
  const [precision, setPrecision] = useState(8);
  const [maxSupply, setMaxSupply] = useState(1);
  const [description, setDescription] = useState("");
  const [symbol, setSymbol] = useState("");
  const [receiver, setReceiver] = useState("");
  const [initialSupply, setInitialSupply] = useState(0);
  const [file, setFile] = useState();
  const [advancedOptions, setAdvancedOptions] = useState({});
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
    event.preventDefault();

    await schema
      .validate(dataYup, { abortEarly: false })
      .then(async () => {
        if (
          await controller.isValidSYSAddress(
            receiver || connectedAccountAddress
          )
        ) {
          controller
            .handleCreateToken(
              Number(precision),
              symbol,
              Number(maxSupply),
              description,
              receiver || connectedAccountAddress,
              // initialSupply,
              ...Object.values(advancedOptions)
            )
            .catch((err) => {
              toast.error(err, { position: "bottom-right" });
            });

          event.target.reset();
          return;
        }
        toast.error("Invalid Address", { position: "bottom-right" });
      })
      .catch((err) => {
        err.errors.forEach((error) => {
          toast.error(error, { position: "bottom-right" });
        });
      });
  };

  const handleInputChange = (setState) => {
    return (event) => {
      setState(event.target.value);
    };
  };

  const handleInputFile = async (event) => {
    const _file = event.target.files[0];

    if (!_file) return;

    if (!["image/jpg", "image/png", "image/jpeg"].includes(_file.type)) {
      //notify the user that the file type is not supported

      return;
    }

    setFile(_file);
  };

  return (
    <section>
      <div className="inner wider">
        <h1>Create a Standard Token (Fungible)</h1>
        <p>This tool helps you create a fungible token on Syscoin.</p>
        <p>
          A fungible token can be interchanged with other individual goods or
          assets of the same type. Each unit of a fungible token has the same
          value, and one coin of the asset is not distinguishable from another.
          Examples: SYS, BTC, stablecoins tokens like AUX and USDT, and
          currencies in general.
        </p>
        <p>
          Familiarize yourself with the backend process this tool uses, if you
          wish.
        </p>
        <p>(backend process)</p>
        <p>
          SysMint automatically follows this logic to create your fungible
          token:
        </p>
        <p>
          1. `assetNew` is executed to create your token according to the specs
          you provided in the form. Ownership (management) of the asset is
          assigned to you by using a newly derived address within your wallet’s
          current selected account.
        </p>{" "}
        <p>
          2. Once the transaction from step 1 settles onchain, `assetSend` is
          then executed to mint the quantity of tokens you specified in the
          field “Initial Circulating Supply”. These tokens are sent to the same
          address derived in step 1. If you left this field 0 (zero), this step
          will not be performed.
        </p>
        <p>
          This process requires you to approve up to two transactions in your
          wallet. The first is for creating the asset, and the second is for
          issuing the initial quantity of tokens into circulation if you
          specified an “Initial Circulating Supply” greater than zero.
        </p>
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
                className="form-control"
                id="initialsupply"
                autoComplete="off"
                disabled={receiver && receiver !== connectedAccountAddress}
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
                <input onChange={handleInputFile} type="file" id="logo" />
                <img src={file ? URL.createObjectURL(file) : assetImg} alt="" />
              </div>
            </div>
          </div>

          <AdvancedPanel
            onChange={setAdvancedOptions}
            toggleButton
            enableIssueSupplyIntoCirculation={Boolean(initialSupply)}
          />

          <div className="btn-center">
            <button>Create Token</button>
          </div>
        </form>
      </div>
    </section>
  );
}
