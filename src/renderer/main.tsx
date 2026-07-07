import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BubbleApp } from "./BubbleApp";

// The same bundle serves both the main window and the floating face bubble.
const isBubble = window.location.hash.startsWith("#bubble");
if (isBubble) document.body.classList.add("bubble-body");

createRoot(document.getElementById("root")!).render(
  isBubble ? <BubbleApp /> : <App />,
);
