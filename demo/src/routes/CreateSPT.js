import React, { useState } from "react";
import { useSelector } from "react-redux";
import * as yup from 'yup'; 
import assetImg from "../images/asset.svg";
import AdvancedPanel from "../components/AdvancedPanel";

export default function CreateSPT() {
  const [precision, setPrecision] = useState(8);
  const [maxSupply, setMaxSupply] = useState(1);
  const [description, setDescription] = useState("");
  const [symbol, setSymbol] = useState("");
  const [receiver, setReceiver] = useState("");
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
  }
  
  const schema = yup.object().shape({
      precision: yup.number().required(),
      symbol: yup.string().required(),
      maxSupply: yup.number().required(),
      description: yup.string().required(),
      receiver: yup.string(),
    });

  const handleCreateToken = async (event) => {
    event.preventDefault();

    await schema.validate(dataYup, { abortEarly: false, })

    if (controller) {
      await controller.handleCreateToken(
        Number(precision),
        symbol,
        Number(maxSupply),
        description,
        receiver || connectedAccountAddress,
        ...Object.values(advancedOptions)
      );

      event.target.reset();
    }
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

        <form onSubmit={handleCreateToken}>
          <div className="row">
            <div className="spacer col-100"></div>
          </div>

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
              <p className="help-block">0 - 8 (default 8)</p>
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
                autocomplete="off"
              />
              <p className="help-block">Ceiling:</p>
            </div>
            <div className="form-group col-33 col-lg-100 lg-spaced-top">
              <label htmlFor="initialsupply">
                Initial Circulating Supply{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                onChange={() => {}}
                type="number"
                className="form-control"
                id="initialsupply"
                placeholder=""
                autocomplete="off"
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
                autocomplete="off"
              />

              <p className="help-block">Max length: 256 bytes</p>
            </div>
            <div className="form-group col-33 col-md-50 col-sm-100">
              <div className="fileupload">
                <label htmlFor="logo">Upload logo</label>
                <input onChange={handleInputFile} type="file" id="logo" />
                <img src={file ? URL.createObjectURL(file) : assetImg} />
              </div>
            </div>
          </div>

          <AdvancedPanel onChange={setAdvancedOptions} toggleButton />

          <div className="btn-center">
            <button>Create Token</button>
          </div>
        </form>
      </div>
    </section>
  );
}
