import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import "./styles/global.css";

let storedTheme: string | null = null;
try { storedTheme = window.localStorage.getItem("tds-color-theme"); } catch { /* Browser storage can be unavailable in privacy-restricted contexts. */ }
const initialTheme = storedTheme === "light" || storedTheme === "dark"
  ? storedTheme
  : "light";
document.documentElement.dataset.theme = initialTheme;
document.documentElement.style.colorScheme = initialTheme;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
