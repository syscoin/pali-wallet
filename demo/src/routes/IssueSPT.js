export default function IssueSPT() {
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

        <form onSubmit={() => {}}>
          <div className="row">
            <div className="spacer col-100"></div>
          </div>

          <div className="form-line">
            <div className="form-group col-100">
              <label htmlFor="token">Standard Token</label>
              <select className="form-control" id="token">
                <option>1</option>
                <option>2</option>
                <option>3</option>
              </select>
            </div>
          </div>

          <div className="form-line gray">
            <div className="form-group col-33 col-md-100">
              <label htmlFor="quantity">
                Quantity to Issue{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input type="number" className="form-control" id="quantity" />
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
                value="999999"
              />
              <p className="help-block">Current Circulating Supply</p>
            </div>
            <div className="form-group col-33 col-md-50 col-xs-100">
              <label>&nbsp;</label>
              <input
                type="text"
                className="form-control"
                disabled
                value="999999"
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
