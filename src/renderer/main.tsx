import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BubbleApp } from "./BubbleApp";
import { QuickRecApp } from "./QuickRecApp";

// The same bundle serves the main window, the floating face bubble, and the
// tray quick-record popover — the location hash picks which app to mount.
const isBubble = window.location.hash.startsWith("#bubble");
const isQuickRec = window.location.hash.startsWith("#quickrec");
if (isBubble) document.body.classList.add("bubble-body");
if (isQuickRec) document.body.classList.add("quickrec-body");

const pickApp = () => {
  if (isBubble) return <BubbleApp />;
  if (isQuickRec) return <QuickRecApp />;
  return <App />;
};

createRoot(document.getElementById("root")!).render(pickApp());
