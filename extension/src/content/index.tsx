// Must run first: content script runs in page context and has no Node "process"
import "../utils/process-polyfill";

import React from "react";
import { createRoot } from "react-dom/client";
import { TipButton } from "./TipButton";
import { findTweetArticles, extractPostIdentity, hasInjectedUI, findActionBar } from "../utils/dom";

/**
 * Content script entry point.
 * Observes the X DOM for tweet articles and injects tip buttons.
 */

const DEBUG = typeof process !== "undefined" && (process.env?.DEBUG_TEEP === "true" || process.env?.DEBUG_TIPCOIN === "true");
if (DEBUG) console.log("[Teep] Content script loaded");

// Inject tip buttons into visible tweets
function injectTipButtons(): void {
  const articles = findTweetArticles();

  for (const article of articles) {
    // Skip if already injected
    if (hasInjectedUI(article)) continue;

    // Extract post identity
    const identity = extractPostIdentity(article);
    if (!identity) continue;

    // Find the action bar to inject next to
    const actionBar = findActionBar(article);
    if (!actionBar) continue;

    // Create mount point
    const mountPoint = document.createElement("div");
    mountPoint.setAttribute("data-teep", "true");
    mountPoint.style.display = "inline-flex";
    mountPoint.style.alignItems = "center";

    // Append to the action bar
    actionBar.appendChild(mountPoint);

    // Mount React component
    const root = createRoot(mountPoint);
    root.render(
      <TipButton
        tweetId={identity.tweetId}
        authorHandle={identity.authorHandle}
      />
    );
  }
}

// Run on load
injectTipButtons();

// Observe DOM mutations (X is a SPA, tweets load dynamically)
const observer = new MutationObserver((mutations) => {
  // Debounce: only process if there are relevant mutations
  let shouldProcess = false;
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      shouldProcess = true;
      break;
    }
  }
  if (shouldProcess) {
    // Use requestAnimationFrame for performance
    requestAnimationFrame(injectTipButtons);
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Re-inject on navigation (X SPA routing)
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    // Small delay to let the new page render
    setTimeout(injectTipButtons, 500);
  }
});
urlObserver.observe(document.querySelector("head")!, { childList: true });

if (DEBUG) console.log("[Teep] DOM observer started");
