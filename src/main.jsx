import React from "react";
import { createRoot } from "react-dom/client";
import "./env.js";
import App from "./CarOS.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
