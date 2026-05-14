# Teep Web

Public web app for Teep: landing page, dashboard, receipt pages, creator/tipper profiles, trust pages, and Grow Tips placeholder.

## Local Development

```bash
cp .env.example .env
npm run dev
```

Local URL:

```text
http://localhost:5174
```

In local development, missing env vars fall back to localhost/API defaults where possible.

## Production Build

Production builds are guarded. They fail if required env vars are missing, if localhost URLs are used, or if the Chrome Store URL is still a placeholder.

Required env:

```bash
VITE_API_URL=https://api.getteep.xyz
VITE_WEB_APP_URL=https://getteep.xyz
VITE_RECEIPT_BASE_URL=https://getteep.xyz
VITE_CHROME_STORE_URL=https://chromewebstore.google.com/detail/teep/REAL_EXTENSION_ID
VITE_PRIVY_APP_ID=...
```

Build:

```bash
npm run build:prod
```

## Routes

- `/` - home / extension CTA
- `/dashboard` - signed-in dashboard
- `/dashboard/withdraw` - withdrawal flow
- `/dashboard/grow-tips` - Grow Tips placeholder
- `/tx/:txHash` - public receipt page
- `/t/:handle/:tweetId` - tip-post CTA page
- `/:username` - creator profile
- `/profile/tipper/:address` - tipper profile
- `/leaderboard` - creator/tipper leaderboard
- `/fees` - fee transparency
- `/terms` - terms
- `/privacy` - privacy policy
- `/support` - support

## Notes

- Current chain target is Arc testnet.
- The web Privy app ID should match the extension Privy app ID.
- Production source maps are disabled in `vite.config.ts`.
