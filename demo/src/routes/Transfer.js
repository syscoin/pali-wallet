export default function Transfer() {
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

        <form>
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
            <div className="form-group col-50 col-md-100">
              <label htmlFor="newaddr">
                New Issuer/Owner Address{" "}
                <i className="icon-info-circled" title="help goes here"></i>
              </label>
              <input
                onChange={() => {}}
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
                onChange={() => {}}
                type="text"
                className="form-control"
                disabled
                value="Saosija089fsf089sef0w98r0923hr0932r90"
              />
              <p className="help-block">Current Issuer/Owner</p>
            </div>
          </div>

          <div className="btn-center">
            <button>Transfer Ownership</button>
          </div>
        </form>
      </div>
    </section>
  );
}
