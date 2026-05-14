# Chrome Web Store — First Version Upload

Scope: **Teep extension (v0.1.0)** in the context of the full Teep project.

---

## What Has Been Achieved (Project Scope)

### Extension functionality
- **Connect**: Privy embedded wallet; connect / logout; theme toggle (dark/light).
- **Dashboard**: Balance (USDC), “Your Impact” (earned / tipped, earned this week), recent activity (avatar, text, amount; green for received); footer (Withdraw, Referral, Support) and “Teep Protocol v0.1.0”.
- **Claim**: Creator claim flow (X OAuth, attestation, claim wallet); Cancel back to dashboard.
- **Withdraw**: To address (with fee breakdown when referral registry set) and “Withdraw to bank” (opens configurable offramp URL); balance card, copy/identity row; theme-aware.
- **Send**: In-extension send to address; balance, presets, Max; theme-aware.
- **History**: Paginated tip history filtered by current tip contract; theme-aware.
- **Referral**: Show my code, “Share Invite”, “Have a referral code?” with apply; theme-aware (including code box and input).
- **Tip flow (X)**: Content script injects tip buttons on x.com/twitter.com; open popup → sign tip (or batch); receipt tweet + receipt image; “Copy tip link” (CTA); milestone prompts ($100 / $500 / $1k) with “Celebrate on X”.
- **Virality**: Withdrawal fee (5%; 30% to referrer); referral codes; receipt tweet; milestone prompts; CTA link; Add funds / Withdraw to bank open configurable URLs (Coinbase Pay placeholders).

### Technical
- **Manifest V3**: Service worker background, content script, popup; permissions and host_permissions defined; CSP for extension pages.
- **Build**: `npm run extension:build` → `extension/dist/` (popup, content, background, manifest; CopyPlugin copies `public/` into `dist/`).
- **Config**: Contract addresses, Privy, USDC decimals, min tip, onramp/offramp URLs; WEB_APP_URL injectable at build time (default `https://tipcoin.xyz` for production build).
- **Theme**: Dark/light applied across connect, claim, withdraw, send, history, referral, and dashboard; Teep header removed; footer “Teep Protocol v0.1.0”.
- **Debug**: Optional debug build (`extension:build:debug`) with in-popup debug panel and console logging.

### Backend / web (needed for extension to work in production)
- Backend: indexer, auth (Privy + X OAuth), tips, referral, milestones, withdrawal breakdown, faucet (dev).
- Web: Home, Fees, Terms, Privacy, Support, CTA `/t/:handle/:tweetId`, creator/tipper profiles, dashboard/withdraw; support@teep.xyz linked.

---

## What’s Left Before Upload (Extension + Store)

| Item | Status | Action |
|------|--------|--------|
| **Extension icons** | Missing | Manifest expects `icon16.png`, `icon48.png`, `icon128.png` in `extension/public/`. **Required**: Add 16×16, 48×48, and 128×128 PNGs (Chrome requires at least 128×128). Without these, the package is invalid and will not load. |
| **Production API URL** | Hardcoded local | `extension/src/utils/config.ts` sets `API_BASE_URL: "http://localhost:3001"`. For store build, extension must call your live backend. **Options**: (1) Add build-time injection (e.g. `process.env.API_BASE_URL` in webpack DefinePlugin and `API_BASE_URL: process.env.API_BASE_URL \|\| "http://localhost:3001"` in config), then e.g. `API_BASE_URL=https://api.teep.xyz npm run extension:build`; or (2) Ship a production config that overwrites the default. |
| **Store listing** | Not in repo | You need: short description, long description, category, screenshots (optional but recommended), promo images if required, **privacy policy URL** (e.g. `https://tipcoin.xyz/privacy`), **support URL** (e.g. `https://tipcoin.xyz/support` or `mailto:support@teep.xyz`). Web already has `/privacy` and `/support`. |
| **Host permissions in production** | Localhost present | Manifest includes `http://localhost:3001/*` for dev. For store submission you may want a **production-only** manifest or build step that omits localhost (reduces review surface; optional but cleaner). |

---

## Verdict: Ready to Upload?

**Not yet.** Fix these first:

1. **Icons (blocking)**  
   Add `icon16.png`, `icon48.png`, `icon128.png` to `extension/public/`. Until then, the extension package is incomplete and Chrome will reject or fail to load it.

2. **Production API (blocking for real use)**  
   Point the extension at your deployed backend (e.g. `https://api.teep.xyz`) via build-time config or a production-only config. Otherwise the published extension will still call `localhost` and not work for users.

3. **Store listing (required by Chrome)**  
   Prepare listing text, privacy policy URL (`https://tipcoin.xyz/privacy` is fine), and support URL (`https://tipcoin.xyz/support` or support@teep.xyz).

After icons + production API + listing are in place, the extension is **suitable for a first Chrome Web Store upload** from a project-scope and “v1 feature set” perspective.

---

## Optional Checks (UI / UX / Security)

- **UI/UX**: Dark/light applied across main flows; no Teep header; footer “Teep Protocol v0.1.0”. For v1, no further change required unless you want another pass (e.g. “Apple Pay” polish, normie copy).
- **Security**: Non-custodial; backend doesn’t hold keys; referral/withdrawal logic and EIP-712 in contracts; extension uses Privy and configured RPC/APIs. No obvious store-blocking security gaps for a first version.
- **Permissions**: Only `storage`, `tabs`, and the listed host_permissions (x.com, twitter.com, Privy, Alchemy, Coinbase, localhost). Justify any new hosts if you add them later.
- **Single store package**: Build one production bundle (with production API URL and no localhost in manifest if you strip it) and use that for the Chrome Web Store upload.

---

## Summary

| Aspect | Status |
|--------|--------|
| **Feature set for v1** | Achieved (connect, tip, claim, withdraw, send, history, referral, themes, virality hooks). |
| **Build & manifest** | OK; icons and production API URL must be set. |
| **Ready to upload** | **No** — add icons, production API URL, and store listing (including privacy + support URLs). |
| **After fixes** | Yes — extension is in scope and suitable for first Chrome Web Store version.
