import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import GardenPreview from "./GardenPreview";
import "./style.css";
// The art preview exists only in development builds.
const preview =
  import.meta.env.DEV &&
  new URLSearchParams(location.search).has("garden-preview");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{preview ? <GardenPreview /> : <App />}</React.StrictMode>,
);
