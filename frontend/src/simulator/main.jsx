import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Simulator from "./Simulator";
import "./simulator.css";

const root = document.getElementById("root");
createRoot(root).render(
  <StrictMode>
    <Simulator />
  </StrictMode>,
);
