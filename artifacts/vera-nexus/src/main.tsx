import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
// Imported for its module-level side effect: it stamps the stored skin onto
// <html> as soon as it evaluates, which is before React renders anything. Any
// later than this and the first paint would show one skin's palette and the
// second frame would show another.
import "./lib/veraSkin";

createRoot(document.getElementById("root")!).render(<App />);
