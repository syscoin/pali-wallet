export default function About() {
  return (
    <section>
      <div className="inner">
        <h1>About / Documentation</h1>
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus quam
          ex, suscipit sagittis orci tincidunt, maximus posuere dui. Morbi porta
          magna hendrerit velit molestie ultricies. Sed a tellus est. Quisque ut
          velit quis orci rutrum congue ut euismod odio. Nunc non ipsum lacus.
          Pellentesque at urna sed arcu ultricies fringilla sit amet a purus.
        </p>
        <p>
          Lorem ipsum dolor sit amet, <a href="#">consectetur adipiscing</a>{" "}
          elit. Vivamus quam ex, suscipit sagittis orci tincidunt, maximus
          posuere dui. Morbi porta magna hendrerit velit molestie ultricies. Sed
          a tellus est. Quisque ut velit quis orci rutrum congue ut euismod
          odio. Nunc non ipsum lacus. Pellentesque at urna sed arcu ultricies
          fringilla sit amet a purus.
        </p>

        <table>
          <tbody>
            <tr>
              <td>
                <h2>First</h2>
                <p>
                  Vivamus quam ex, suscipit sagittis orci tincidunt, maximus
                  posuere dui. Morbi porta magna hendrerit velit molestie
                  ultricies. Sed a tellus est.{" "}
                </p>
              </td>
              <td>
                <h2>Second</h2>
                <p>
                  Quisque ut velit quis orci rutrum congue ut euismod odio. Nunc
                  non ipsum lacus.
                </p>
              </td>
              <td>
                <h2>Third</h2>
                <p>
                  Ut odio metus, convallis id vulputate eu, tincidunt vitae ex.
                  Integer aliquet turpis.
                </p>
              </td>
            </tr>
          </tbody>
        </table>

        <h2>Ut odio metus, convallis id</h2>
        <ul>
          <li>Lorem ipsum dolor sit amet</li>
          <li>Ut odio metus, convallis id</li>
          <li>Lorem ipsum dolor sit amet</li>
          <li>Ut odio metus, convallis id</li>
        </ul>

        <ol>
          <li>Lorem ipsum dolor sit amets</li>
          <li>Ut odio metus, convallis ids</li>
          <li>Ut odio metus, convallis id</li>
          <li>Lorem ipsum dolor sit amet</li>
        </ol>

        <p>Use this:</p>
        <pre>
          {" "}
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut odio
          metus, convallis id vulputate eu, tincidunt vitae ex. Integer aliquet
          turpis ac consequat tempus. Vivamus sit amet lorem eros.{" "}
        </pre>

        <blockquote>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut odio
          metus, convallis id vulputate eu, tincidunt vitae ex. Integer aliquet
          turpis ac consequat tempus. Vivamus sit amet lorem eros.
        </blockquote>
      </div>
    </section>
  );
}
