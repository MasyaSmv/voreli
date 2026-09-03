import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { StatusPage } from "../pages/status/StatusPage";
import { Providers } from "./providers";
import "./styles.css";

const container = document.getElementById("root");

if (container === null) {
  throw new Error("Root container #root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <Providers>
      <StatusPage />
    </Providers>
  </StrictMode>,
);
