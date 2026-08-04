import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import { initializeTheme } from "./lib/theme";
import "./styles/index.css";

initializeTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

if (document.documentElement.dataset.splash === "on") {
  window.setTimeout(() => {
    document.body.classList.add("gdt-app-ready");
  }, 5000);
} else {
  document.body.classList.add("gdt-app-ready");
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
