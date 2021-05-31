import "bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";
import Header from "./components/Header";
import { buttons } from "./data";

const Menu = () => {
  const RenderButtons = () => {
    return buttons.map((item) => {
      return <a key={item.route} className="button" href={item.route}>{item.title}</a>
    })}

  return (
    <div className="app">
      {/* <Header /> */}
      <RenderButtons />
    </div>
  );
}

export default Menu;