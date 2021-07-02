import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import * as yup from "yup";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.min.css";

import assetImg from "../images/asset.svg";
import AdvancedPanel from "../components/AdvancedPanel";
import loaderImg from "../images/spinner.svg";

export default function Update() {
  const controller = useSelector((state) => state.controller);
  const [tokens, setTokens] = useState([]);
  const [file, setFile] = useState();
  const [assetGuid, setAssetGuid] = useState();
  const [description, setDescription] = useState("");
  const [advancedOptions, setAdvancedOptions] = useState({});
  const [isLoading, setIsLoading] = useState(true);

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
    description,
  };

  const schema = yup.object().shape({
    assetGuid: yup.string().required("Token is required!"),
    description: yup.string(),
  });

  const handleUpdateAsset = async (event) => {
    event.preventDefault();

    await schema
      .validate(dataYup, { abortEarly: false })
      .then(() => {
        controller &&
          controller
            .handleUpdateAsset(
              assetGuid,
              description,
              ...Object.values(advancedOptions)
            )
            .catch((err) => {
              toast.error(err);
            });

        event.target.reset();
      })
      .catch((err) => {
        err.errors.forEach((error) => {
          toast.error(error);
        });
      });
  };

  const handleInputChange = (setState) => {
    return (event) => {
      setState(event.target.value);
    };
  };

  const handleInputFile = (setState) => {
    return async (event) => {
      const _file = event.target.files[0];

      setState(_file);

      // upload image
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

        <form onSubmit={handleUpdateAsset}>
          <div className="row">
            <div className="spacer col-100"></div>
          </div>
          <ToastContainer />
          <div className="form-line">
            <div className="form-group col-100">
              <label htmlFor="token">
                Standard Token&nbsp;
                {isLoading && <img className="loaderTokens" src={loaderImg} />}
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
                <img src={file ? URL.createObjectURL(file) : assetImg} alt="" />
              </div>
            </div>
          </div>

          <AdvancedPanel
            onChange={setAdvancedOptions}
            renderContractField
            toggleButton={false}
          />

          <div className="btn-center">
            <button>Update Token</button>
          </div>
        </form>
      </div>
    </section>
  );
}
