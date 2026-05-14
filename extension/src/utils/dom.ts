/**
 * DOM utilities for extracting post data from X (twitter.com / x.com).
 *
 * Strategy: Read only what the user sees. No API calls, no scraping.
 * We parse the DOM structure of tweet articles to extract IDs.
 */

export interface PostIdentity {
  tweetId: string;
  /** Original @handle as displayed on X */
  authorHandle: string;
}

/**
 * Extract tweet ID and author info from a tweet article element.
 * X renders tweets as <article> elements with status links.
 *
 * The canonical author ID is resolved by the background worker through
 * /auth/x/user/:username before transaction calldata is built.
 */
export function extractPostIdentity(article: HTMLElement): PostIdentity | null {
  try {
    // Find the status link: /username/status/1234567890
    const statusLinks = article.querySelectorAll('a[href*="/status/"]');
    let tweetId: string | null = null;
    let authorHandle: string | null = null;

    for (const link of statusLinks) {
      const href = (link as HTMLAnchorElement).href;
      // Support /status/ and /article/; reject username-less /i/status/ (author unknown from URL)
      const match = href.match(/\/([^/]+)\/(?:status|article)\/(\d+)/);
      if (match) {
        const segment = match[1];
        if (segment.toLowerCase() === "i") continue; // x.com/i/status/{id} has no author in path
        authorHandle = segment;
        tweetId = match[2];
        break;
      }
    }

    if (!tweetId || !authorHandle) return null;

    return { tweetId, authorHandle };
  } catch {
    return null;
  }
}

/**
 * Find all tweet articles currently visible in the DOM.
 * X may remove or change data-testid; fallback: any article containing a status link.
 */
export function findTweetArticles(): HTMLElement[] {
  const byTestId = document.querySelectorAll('article[data-testid="tweet"]');
  if (byTestId.length > 0) return Array.from(byTestId) as HTMLElement[];

  const articles = document.querySelectorAll("article");
  const out: HTMLElement[] = [];
  for (const el of articles) {
    const a = el as HTMLElement;
    const statusLink = a.querySelector('a[href*="/status/"]');
    if (statusLink && /\/[^/]+\/(?:status|article)\/\d+/.test((statusLink as HTMLAnchorElement).href)) {
      out.push(a);
    }
  }
  return out;
}

/**
 * Check if our tip UI has already been injected into an article
 */
export function hasInjectedUI(article: HTMLElement): boolean {
  return article.querySelector("[data-teep]") !== null;
}

/**
 * Find the action bar in a tweet article (where like/retweet/share buttons are).
 * X may have multiple [role="group"]; we want the one that contains the reply/repost/like row.
 */
export function findActionBar(article: HTMLElement): HTMLElement | null {
  const appBar = article.querySelector('[data-testid="app-bar-cell"]');
  if (appBar) return appBar as HTMLElement;

  const groups = article.querySelectorAll('[role="group"]');
  for (const g of groups) {
    const el = g as HTMLElement;
    const links = el.querySelectorAll('a[role="button"], button, [data-testid]');
    if (links.length >= 3) return el;
  }
  if (groups.length > 0) return groups[groups.length - 1] as HTMLElement;

  // Fallback: container with many links (engagement bar is link-heavy)
  const allDivs = article.querySelectorAll("div[role='group']");
  for (const d of allDivs) {
    const el = d as HTMLElement;
    const links = el.querySelectorAll("a");
    if (links.length >= 4) return el;
  }

  // Last resort: parent of the status link row (find a[href*="/status/"] then a sibling section with many links)
  const statusLink = article.querySelector('a[href*="/status/"]');
  if (statusLink) {
    let parent = statusLink.parentElement;
    for (let i = 0; i < 8 && parent; i++) {
      const withLinks = parent.querySelectorAll("a");
      if (withLinks.length >= 4) return parent as HTMLElement;
      parent = parent.parentElement;
    }
  }
  return null;
}
