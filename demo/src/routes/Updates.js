export default function Update() {
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

        <form>
          <div className="row">
            <div className="spacer col-100"></div>
          </div>

          <div className="form-line">
            <div className="form-group col-100">
              <label htmlFor="token">Token</label>
              <select className="form-control" id="token">
                <option>1</option>
                <option>2</option>
                <option>3</option>
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

              <div className="form-line spaced-top">
                <div className="form-group col-100">
                  <label htmlFor="contract">
                    Contract{" "}
                    <i className="icon-info-circled" title="help goes here"></i>
                  </label>
                  <input
                    onChange={() => {}}
                    type="text"
                    className="form-control"
                    id="contract"
                    placeholder=""
                  />
                  <p className="help-block">
                    ERC-20 Contract linked to this token via Syscoin Bridge
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="btn-center">
            <button>Update Token</button>
          </div>
        </form>
      </div>
    </section>
  );
}