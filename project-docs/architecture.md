System Architecture: X Post Tipping on Base
Design goals (non-negotiable)

Non-custodial

Creator does not need to onboard first

Works entirely as a browser extension

Gasless UX for users

Deterministic, claimable ownership

Minimal reliance on X APIs

Event-driven, indexer-first

1. High-level system diagram (mental model)
┌──────────────┐
│  X Website   │
│ (x.com DOM)  │
└──────┬───────┘
       │ DOM read (post + author IDs)
       ▼
┌────────────────────┐
│ Browser Extension  │
│ - UI injection    │
│ - Privy auth      │
│ - Wallet actions  │
└──────┬─────────────┘
       │ tx intent
       ▼
┌────────────────────┐
│ Smart Wallet (AA)  │
│ ERC-4337 on Base   │
└──────┬─────────────┘
       │ calls
       ▼
┌────────────────────┐
│ Tipping Contract   │
│ (events only)      │
└──────┬─────────────┘
       │ events
       ▼
┌────────────────────┐
│ Indexer / Backend  │
│ - Event ingestion  │
│ - Aggregation      │
│ - OAuth attestation│
└────────────────────┘

2. Client layer: Browser extension
Responsibilities
A. DOM integration

Injects UI under each X post:

Tip button

Total tipped amount

Extracts:

tweetId

authorId (numeric, embedded in page data)

Normalizes post identity:

canonical = "x.com/{authorId}/status/{tweetId}"
contentId = keccak256(canonical)


No scraping, no crawling, only what the user sees.

B. Authentication

Uses Privy

Email-based onboarding

Embedded wallet signer

Does not ask for X credentials directly

C. Transaction orchestration

User clicks “Tip”

Extension:

Resolves recipient wallet (deterministic)

Constructs transaction

Sends via ERC-4337 (gas sponsored)

D. Read path (display totals)

Calls backend:

GET /tips/{contentId}


Renders aggregated total instantly

3. Wallet layer: Account Abstraction (Base)
Wallet type

ERC-4337 smart account

Privy-managed signer

Paymaster for gas sponsorship

Two wallet classes
1. User Wallet

Created when a user installs extension

Owned by Privy signer

Can:

Send tips

Receive tips

Withdraw

2. Claim Wallet (per X author)

Deterministic address via CREATE2

Derived from:

salt = keccak256("X", authorId)


May not be deployed yet

Receives tips before creator exists

This is the key primitive.

4. Smart contracts
4.1 Wallet factory

Responsibilities:

Deterministically compute claim wallet addresses

Deploy wallets when claimed

function computeClaimWallet(uint256 authorId) returns (address);
function deployClaimWallet(uint256 authorId, InitData init);

4.2 Tipping contract (stateless)

This contract does not store balances.
It emits events only.

event Tipped(
  bytes32 indexed contentId,
  uint256 indexed authorId,
  address indexed from,
  address to,
  uint256 amount
);

function tip(
  bytes32 contentId,
  uint256 authorId
) payable;


Flow:

Resolve claimWallet(authorId)

Forward ETH

Emit event

Why no onchain storage?

Cheaper

More scalable

Indexer-friendly

No need for upgrades

5. Backend / Indexer

This is not a custodian. It never touches funds.

5.1 Event ingestion

Subscribes to Base

Listens for Tipped events

Stores:

contentId → total tipped

authorId → total received

wallet → activity

5.2 Read API

Used by extension:

GET /tips/{contentId}

GET /author/{authorId}/total

GET /wallet/{address}/history

5.3 OAuth attestation service

Only needed when creator claims funds.

Flow:

User authenticates with X OAuth

Backend verifies:

OAuth token

authorId

Backend signs:

Attestation {
  authorId,
  timestamp,
  nonce
}


This attestation:

Is short-lived

Used once

Never stored long-term

6. Claiming ownership flow (critical path)
Step 1: Tips already exist
Funds sit in claimWallet(authorId)
Wallet may not exist yet

Step 2: Creator installs extension

Auth via Privy
OAuth with X
Backend issues attestation

Step 3: Wallet deployment

Extension:
Calls factory
Deploys claim wallet
Initializes owner = Privy signer
Attestation validated during init

Now:
Creator owns wallet
All past tips unlocked
Future tips flow to same wallet

7. Withdrawals
Flow
User initiates withdrawal
Backend sends confirmation code to email
User confirms
Smart wallet executes transfer to EOA

Safeguards
Daily withdrawal limits
Email + signer required

8. Security model

What you do not trust?
Backend (no signing power)
Extension environment
X UI stability

What you do trust?
Onchain logic
Deterministic address derivation
ERC-4337 validation
OAuth signatures

9. Policy-safe design choices

No X API scraping
No credential harvesting
No impersonation
Clear non-affiliation disclaimer
User-initiated actions only

10. Failure modes & handling
Scenario	Outcome
Creator never claims	Funds stay safe forever
Post deleted	Tips still withdrawable
Handle changes	No effect (authorId stable)
Backend down	Tips still work
Extension removed	Wallet still exists