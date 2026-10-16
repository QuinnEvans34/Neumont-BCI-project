import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import GardenPreview from "./GardenPreview";
import CairnPreview from "./CairnPreview";
import "./style.css";
// The previews exist only in development builds.
const query = new URLSearchParams(location.search);
const preview = import.meta.env.DEV && query.has("garden-preview");
const bench = import.meta.env.DEV && query.has("cairn-preview");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {preview ? <GardenPreview /> : bench ? <CairnPreview /> : <App />}
  </React.StrictMode>,
);
