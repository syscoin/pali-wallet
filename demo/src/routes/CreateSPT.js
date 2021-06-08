export default function CreateSPT() {
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

        <form onSubmit={() => {}}>
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
                onChange={() => {}}
                type="text"
                className="form-control"
                id="symbol"
                placeholder=""
              />
              <p className="help-block">Max length: 8 alpha-numeric</p>
            </div>
            <div className="form-group col-67 col-xs-100 xs-spaced-top">
              <label htmlFor="owneraddr">
                Issuer/Owner Address{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                onChange={() => {}}
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
                onChange={() => {}}
                type="range"
                id="precision"
                name="points"
                min="0"
                max="8"
                value="8"
              />
              <p className="help-block">0 - 8 (default 8)</p>
            </div>
            <div className="form-group col-33 col-lg-50 col-xs-100 xs-spaced-top">
              <label htmlFor="supply">
                Max supply{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                onChange={() => {}}
                type="number"
                className="form-control"
                id="supply"
                placeholder=""
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
              <textarea
                className="form-control"
                id="description"
                rows="4"
              ></textarea>
              <p className="help-block">Max length: 256 bytes</p>
            </div>
            <div className="form-group col-33 col-md-50 col-sm-100">
              <div className="fileupload">
                <label htmlFor="logo">Upload logo</label>
                <input onChange={() => {}} type="file" id="logo" />
                <img src="imgs/asset.svg" />
              </div>
            </div>
          </div>

          <div className="form-line gray">
            <div className="form-group col-100">
              <div className="advanced open">
                Advanced <i className="icon-right-open"></i>
                <i className="icon-down-open"></i>
              </div>
            </div>
            <div className="advanced-panel open">
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
