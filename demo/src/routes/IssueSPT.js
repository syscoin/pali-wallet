import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast, ToastContainer } from "react-toastify";
import * as yup from "yup";
import { Modal } from 'react-responsive-modal';

import 'react-responsive-modal/styles.css';
import "react-toastify/dist/ReactToastify.min.css";
import loaderImg from "../images/spinner.svg";

export default function IssueSPT() {
  const [assetGuid, setAssetGuid] = useState("");
  const [asset, setAsset] = useState({ maxSupply: "", totalSupply: "" });
  const [amount, setAmount] = useState(1);
  const [tokens, setTokens] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const controller = useSelector((state) => state.controller);

  useEffect(() => {
    controller &&
      controller.getUserMintedTokens().then((data) => {
        data && setTokens(data);
      });

    return () => setTokens([]);
  }, []);

  useEffect(() => {
    if (controller && assetGuid) {
      controller.getDataAsset(assetGuid).then((data) => {
        const { maxSupply, totalSupply, decimals } = data;
        setAsset({
          maxSupply: maxSupply / Math.pow(10, decimals),
          totalSupply: totalSupply / Math.pow(10, decimals),
        });
      });
    }
  }, [assetGuid]);

  useEffect(() => {
    tokens.length && setIsLoading(false);
  }, [tokens]);

  const dataYup = {
    amount,
    assetGuid,
  };

  const schema = yup.object().shape({
    amount: yup
      .number()
      .typeError("Quantity to Issue is required!")
      .min(1)
      .required("Quantity to Issue is required!"),
    assetGuid: yup.string().required("Standard Token is required!"),
  });

  const handleIssueSPT = async (event) => {
    event.preventDefault();

    await schema
      .validate(dataYup, { abortEarly: false })
      .then(async () => {
        if (amount < asset.maxSupply - asset.totalSupply) {
          controller &&
            controller
              .handleIssueSPT({amount: Number(amount), assetGuid})
              .catch((err) => {
            toast.dismiss();
            toast.error(err, {position: "bottom-right"});
              });
          return;
        }
        toast.error("Invalid Quantity to Issue", {position: "bottom-right"});
      })
      .catch((err) => {
        err.errors.forEach((error) => {
          toast.dismiss()
          toast.error(error, {position: "bottom-right"});
        });
      });
  };

  const handleInputChange = (setState) => {
    return (event) => {
      setState(event.target.value);
    };
  };

  const onOpenModal = () => setOpen(true);
  const onCloseModal = () => setOpen(false);

  return (
    <section>
      <div className="inner">
        <h1>Issue Fungible Tokens into Circulation</h1>
        <p>Issue more tokens of your fungible asset (a standard SPT) into circulation.
          The maximum total quantity of tokens that you can issue is limited by the Max Supply value set in the token definition.
        </p>
        <p>
          Familiarize yourself with the{" "}
           <span
           className="modalOpen"
           onClick={onOpenModal} >backend process</span>
           {" "} this tool uses, if you
          wish.
        </p>
        <Modal open={open} onClose={onCloseModal} center>
        <p>
        SysMint automatically follows this process to issue more tokens into circulation.
        </p>
        <p>
          1. `assetSend` is executed, issuing your specified quantity. These new
           tokens are minted at your Owner/Issuer address, from which these
            tokens can then be sent to recipients using your wallet.
        </p>{" "}

        </Modal>
        <form onSubmit={handleIssueSPT}>
          <div className="row">
            <div className="spacer col-100"></div>
          </div>
          <ToastContainer />
          <div className="form-line">
            <div className="form-group col-100">
            <label htmlFor="token" className="loaderTokens">
                <span >
                  Standard Token{" "}
                  {isLoading && (
                    <img  src={loaderImg} alt="" />
                  )}
                </span>
              </label>
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

          <div className="form-line gray">
            <div className="form-group col-33 col-md-100">
              <label htmlFor="quantity">
                Quantity to Issue{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                onChange={handleInputChange(setAmount)}
                type="number"
                className="form-control"
                id="amount"
                value={amount}
              />
              <p className="help-block">
                Ceiling: Max Supply
                <br />
                This value will be minted and sent to the token issuer/owner
                address for further distribution.
              </p>
            </div>
            <div className="form-group col-33 col-md-50 col-xs-100">
              <label>&nbsp;</label>
              <input
                type="text"
                className="form-control"
                disabled
                value={Intl.NumberFormat("en", {
                  minimumFractionDigits: 2,
                }).format(asset.totalSupply)}
              />
              <p className="help-block">Current Circulating Supply</p>
            </div>
            <div className="form-group col-33 col-md-50 col-xs-100">
              <label>&nbsp;</label>
              <input
                type="text"
                className="form-control"
                disabled
                value={Intl.NumberFormat("en", {
                  minimumFractionDigits: 2,
                }).format(asset.maxSupply)}
              />
              <p className="help-block">Max Supply</p>
            </div>
          </div>

          <div className="btn-center">
            <button>Issue Tokens</button>
          </div>
        </form>
      </div>
    </section>
  );
}
