import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.min.css";
import * as yup from "yup";

import loaderImg from "../images/spinner.svg";

export default function Transfer() {
  const [tokens, setTokens] = useState([]);
  const [assetGuid, setAssetGuid] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const controller = useSelector((state) => state.controller);
  const [isLoading, setIsLoading] = useState(true);
  const { connectedAccountAddress } = useSelector(
    (state) => state.connectedAccountData
  );

  useEffect(() => {
    controller &&
      controller.getUserMintedTokens().then((data) => {
        data && setTokens(data);
      });

    return () => setTokens([]);
  }, []);

  useEffect(() => {
    tokens.length && setIsLoading(false);
  }, [tokens]);

  const dataYup = {
    assetGuid,
    newOwner,
  };

  const schema = yup.object().shape({
    assetGuid: yup.string().required("Standard Token is required!"),
    newOwner: yup.string().required("New Issuer is required!"),
  });

  const handleInputChange = (setState) => {
    return (event) => {
      setState(event.target.value);
    };
  };

  const handleTransferOwnership = async (event) => {
    event.preventDefault();

    await schema
      .validate(dataYup, { abortEarly: false })
      .then(async () => {
        if (await controller.isValidSYSAddress(newOwner)) {
          controller &&
            controller
              .handleTransferOwnership(assetGuid, newOwner)
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

  return (
    <section>
      <div className="inner">
        <h1>Issue Fungible Tokens into Circulation</h1>
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

        <form onSubmit={handleTransferOwnership}>
          <div className="row">
            <div className="spacer col-100"></div>
          </div>

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
            <div className="form-group col-50 col-md-100">
              <label htmlFor="newaddr">
                New Issuer/Owner Address{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                onChange={handleInputChange(setNewOwner)}
                type="text"
                className="form-control"
                id="newaddr"
              />
              <p className="help-block">
                Token ownership will be transfered to this address
              </p>
            </div>
            <div className="form-group col-50 col-md-100">
              <label>&nbsp;</label>
              <input
                type="text"
                className="form-control"
                disabled
                value={connectedAccountAddress}
              />
              <p className="help-block">Current Issuer/Owner</p>
            </div>
          </div>
          <ToastContainer />
          <div className="btn-center">
            <button>Transfer Ownership</button>
          </div>
        </form>
      </div>
    </section>
  );
}
