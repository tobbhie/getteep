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

Production builds are guarded. They fail if required env vars are missing or localhost URLs are used.

Required env:

```bash
VITE_API_URL=https://api.getteep.xyz
VITE_WEB_APP_URL=https://getteep.xyz
VITE_RECEIPT_BASE_URL=https://getteep.xyz
VITE_PRIVY_APP_ID=...
```

Build:

```bash
npm run build:prod
```

## Routes

- `/` - home / product CTA
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
- The web Privy app ID should match the backend auth configuration.
- Production source maps are disabled in `vite.config.ts`.
