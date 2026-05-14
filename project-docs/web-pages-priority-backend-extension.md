# Web Pages — Order of Importance (Backend Upload & Extension Hosting)

Context: **backend deployment** and **Chrome Web Store / extension hosting**. The extension and store listing depend on the web app being live (privacy URL, support URL, landing, CTA).

---

## Order of importance (high → low)

| # | Route | Page | Importance | Conclusive? | What's left (if any) |
|---|--------|------|------------|-------------|----------------------|
| 1 | `/` | **Home (Landing)** | Critical | **Inconclusive** | Replace Chrome Web Store placeholder with real extension URL; messaging pass (“Cash App for X posts”, no crypto buzzwords above fold); optional social proof / “How it works”; SEO (meta, OG); mobile/responsive. Tip form and add-funds flow are in place; balance uses `usdc-balance`; address resolution includes `user.wallet` fallback. |
| 2 | `/support` | **Support** | Required (store) | **Inconclusive** | Chrome requires a support URL. Page exists. Left: clear contact (e.g. support@teep.xyz), FAQ (how to tip, withdraw, “tips are final”), set expectations (no dispute reversal). |
| 3 | `/privacy` | **Privacy** | Required (store) | **Inconclusive** | Chrome requires privacy policy URL. Page exists. Left: legal review; what we collect (email, wallet, X linkage), retention, target regions (e.g. GDPR). |
| 4 | `/dashboard` | **Dashboard** | Core | **Conclusive** (MVP) | Balance (usdc-balance), add funds, creator vs non-creator views, history. Optional: polish, “Apple Pay” feel. |
| 5 | `/dashboard/withdraw` | **Dashboard Withdraw** | Core (creators) | **Conclusive** (MVP) | Withdraw to address, fee breakdown, “Withdraw to bank” (offramp URL). Architecture items left: email confirmation before withdraw, daily limits, email+signer required (see whats-left-for-production). |
| 6 | `/t/:handle/:tweetId` | **Tip Post (CTA)** | High | **Inconclusive** | “Tip this post”, total tipped, extension install CTA. Left: normie copy (e.g. “This post has received $X in tips”, avoid “USDC” if targeting non-crypto); OG/Twitter cards; mobile; optional “Open in X to tip with extension” vs “Install extension” logic. |
| 7 | `/fees` | **Fees** | Trust | **Conclusive** (MVP) | Fee structure described. Optional: align copy with tokenomics; “No fees when tipping” prominent; simple calculator. |
| 8 | `/terms` | **Terms** | Legal | **Inconclusive** | Page exists. Left: legal review; “tips are final”, no refunds, X Corp disclaimer. |
| 9 | `/leaderboard` | **Leaderboard** | Engagement | **Conclusive** (MVP) | Backend can serve data. Optional: polish, filters. |
| 10 | `/:username` | **Creator Profile** | Public | **Conclusive** (MVP) | Profile by username, lifetime tips, top posts, top supporters. Left (virality): milestones reached; share profile; empty state; SEO/OG; responsive. |
| 11 | `/profile/tipper/:address` | **Tipper Profile** | Public | **Conclusive** (MVP) | Address, total tipped, creators supported. Left: early supporter badges; optional tipper identity/opt-out; responsive, SEO. |

---

## Summary

| Status | Count | Pages |
|--------|-------|--------|
| **Conclusive (MVP)** | 6 | Dashboard, Dashboard Withdraw, Fees, Leaderboard, Creator Profile, Tipper Profile |
| **Inconclusive** | 5 | Home, Support, Privacy, Tip Post (CTA), Terms (+ withdraw safeguards in backend) |

**Blocking for extension hosting:** Support URL and Privacy URL must be live and acceptable to Chrome; Home is the main landing. Backend must be deployed so extension and web call the same API (e.g. production API URL in extension build).

**What’s left (high level):** Store listing (icons, production API URL, description, privacy + support URLs); web copy/design pass on Home and CTA; legal pass on Terms/Privacy; optional withdrawal safeguards and onramp/offramp polish (see `whats-left-for-production.md` and `extension-chrome-store-v1.md`).
