# FRONTEND.md — Tradelock web app

Spec for `web/` (Next.js App Router + TypeScript). The app's job: let buyer, supplier, and arbiter run a deal end to end, and let a judge *see* both legs settle, with every on-chain fact linked to an explorer.

---

## 1. Stack

- Next.js (App Router), TypeScript strict, React Server Components where data is public, client components for wallets.
- NEAR: `@hot-labs/near-connect@0.11.4` (wallet connector used by NEAR's docs; HOT, Meteor, Intear, MyNearWallet, NEAR CLI, …); view calls via JSON-RPC `fetch`. Pinned: next 16.4.2, react 19.3.1, @tanstack/react-query 5.104.5, viem 2.57.16 (D-022).
- EVM: `viem` + injected wallet (supplier's eBL transfer on Sepolia; buyer sees title).
- Data: TanStack Query for polling views/events.
- Styling: CSS variables + CSS modules (or Tailwind if preferred; tokens in §7 either way).
- Shared module `@tradelock/shared`: deal types, state enums, derivation path, `derivedAddress(dealId)`, explorer URL builders. Generated/kept in sync with contract ABI.

## 2. Routes

| Route | Who | Purpose |
|---|---|---|
| `/` | everyone | One-sentence explanation, live demo deal link, "Start a deal" |
| `/deals` | signed-in party | Deals where the account is buyer, supplier, or arbiter |
| `/deals/new` | buyer | Create deal (terms form) |
| `/deals/[id]` | everyone (details per D-010) | Deal page: two legs, state timeline, actions for the signed-in party |
| `/demo` | judges | Read-only view of the recorded settled and refunded demo deals with all links |

## 3. Flows by role

### Buyer
1. `/deals/new`: supplier account, arbiter account, token, amount, mode (eBL / escrow-only), registry + token id (eBL), buyer EVM address (receives title), ship-by and deliver-by dates, order document (hash computed client-side; file never uploaded on-chain).
2. Sign `create_deal` (gasless via relayer; storage deposit paid directly — relayer can't attach deposit, so this one call shows "needs a small NEAR deposit").
3. After supplier accepts: "Fund deal" → guidance if stablecoin isn't in Intents balance yet (1Click deposit), then `mt_transfer_call`.
4. Check the deal's TitleEscrow on Sepolia (shown live on the deal page), then "Confirm bill of lading held" (D-019). The page then shows the acceptance deadline: "Accept documents" (pay and receive title) or "Refuse documents" (cash back, title back to supplier). Silence past the deadline lets anyone release. After settlement, check Sepolia again and "Confirm title received". Escrow-only deals: "Confirm delivery". Dispute; vote; claim refund after `ship_by` / `deliver_by`.

### Supplier
1. Accept or decline.
2. After funding: "Hand over the bill of lading" → shows the deal's Sepolia address; connect EVM wallet; sign the TitleEscrow transfer (holder + beneficiary → deal address) with viem [VERIFY v5 method].
3. If the buyer stays silent: open a dispute before `deliver_by` (T4), or ask the arbiter to co-confirm title held (D-019).
4. Choose payout target (internal NEAR account / withdraw chain + address).
5. Watch settlement.

### Arbiter
Sees disputed deals and pending confirmations; checks evidence links on Sepolia; votes or co-confirms a fact when a party is silent (D-019).

### Judge (no wallet)
`/demo` and any `/deals/[id]` show state, timeline, and explorer links without signing in.

## 4. Deal page (the screen that sells the project)

Layout: two columns, one per leg, converging on a central release seal.

```
┌───────────── CASH ─────────────┐   ┌───────────── TITLE ─────────────┐
│ USDC 1.00 held by deal          │   │ eBL #12 on Sepolia              │
│ Funded  ✓  tx ↗                 │   │ Held by deal address 0x…  ✓  ↗  │
│ Paid to supplier ✓  tx ↗        │   │ Transferred to buyer ✓  tx ↗    │
└───────────────┬─────────────────┘   └────────────────┬────────────────┘
                └──────────────►  RELEASED  ◄──────────┘
                     Settled · both legs confirmed
Timeline (eBL): Created → Funded → Title held → Documents accepted → Settling → Settled
Actions (for signed-in party): Accept · Fund · Hand over bill of lading · Confirm held · Accept documents · Refuse documents · Dispute · Vote · Claim refund
```

- The seal is the one orchestrated motion in the app: when the deal reaches `Settled`, the seal stamps once. Respect `prefers-reduced-motion` (no motion; state change shown instantly).
- Each leg shows its sub-state from `CashLeg` / `TitleLeg` with plain-language labels (§6).
- Every on-chain fact has an explorer link: NEAR explorer for NEAR txs/events, Sepolia Etherscan for title txs and the TitleEscrow.
- Escrow-only deals show only the cash column; the title column reads "No bill of lading in this deal."

## 5. Data

- Polling: `get_deal(id)` every 5s while not terminal; stop on terminal.
- Timeline: derived from contract state and the stored confirmation log (D-022); no indexer. Transaction links: action results, the title transfer hash (`report_broadcast`), and each confirmation's Sepolia block.
- Sepolia reads (viem public client): TitleEscrow `holder()` / `beneficiary()` shown live next to the contract's recorded state, so a judge sees both agree.
- Privacy (D-010): until resolved, show only what the contract publicly stores. Never display data that the README claims is private.

## 6. Copy

Plain language, active voice, sentence case. Same name for an action throughout the flow.

| System state | UI label |
|---|---|
| `Created` (not accepted) | Waiting for supplier to accept |
| `Created` (accepted) | Waiting for buyer to fund |
| `Funded` (eBL) | Funded — waiting for the bill of lading |
| `Funded` (escrow-only) | Funded — waiting for delivery |
| `TitleHeld` | Documents ready — accept by {accept_by} to pay and receive the bill of lading |
| `Settling` | Releasing payment and title |
| `Settled` | Released: supplier paid, buyer owns the goods |
| `Disputed` | In dispute — 2 of 3 votes decide |
| `Refunding` | Returning payment and bill of lading |
| `Refunded` | Returned: buyer refunded, supplier holds the bill of lading |
| `Cancelled` | Cancelled before funding |

Buttons: "Accept deal", "Fund deal", "Hand over bill of lading", "Confirm bill of lading held", "Accept documents", "Refuse documents", "Release payment" (anyone, after the deadline), "Confirm delivery" (escrow-only), "Confirm title received", "Open dispute", "Vote to release", "Vote to refund", "Claim refund", "Return bill of lading again" (redelivery).

Errors say what happened and what to do, mapped from contract errors:
- `AmountMismatch` → "The amount sent doesn't match the deal. It was returned to you. Send exactly 1.00 USDC."
- `DeadlinePassed` → "The acceptance deadline has passed. The payment can now be released."
- `Unauthorized` → "Only the buyer can fund this deal. Switch to the buyer's account."
- Relayer down → "Gasless sending is unavailable. Send this action from your wallet instead."

Empty states invite action: `/deals` with none → "No deals yet. Start a deal with a supplier."

## 7. Design direction

Subject: shipping documents and the moment of release — bills of lading, carbon-copy forms, rubber stamps. Distinctive, quiet, document-like; boldness spent only on the release seal.

### Tokens (light / dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F6F7F5` | `#15191D` | page background |
| `--sheet` | `#FFFFFF` | `#1D2329` | leg panels |
| `--ink` | `#1E2328` | `#E6E8EA` | body text |
| `--form-blue` | `#1F4E8C` | `#7FA8E0` | links, form rules, active states (carbon-copy ink) |
| `--stamp-red` | `#A8322A` | `#E0786E` | release seal, destructive/dispute actions |
| `--muted` | `#5D6670` | `#9AA3AC` | secondary text |

Rules: colors defined on `:root`; dark values under `@media (prefers-color-scheme: dark)`; every text color sits on its paired surface; contrast ≥ 4.5:1.

### Type
- One family for UI and headings with a clear scale (e.g., a sober grotesque with good tabular figures [choose deliberately; avoid default stacks]); hashes and addresses in a monospace face because they are literally fixed-width data.
- Amounts use tabular figures.
- No all-caps labels, no eyebrow labels, no single accented word in headlines.

### Layout
- Left-aligned text; the two leg panels are the page's structure (they encode the two legs — not decoration).
- Mobile: legs stack vertically, seal between them.
- Visible keyboard focus; all actions reachable by keyboard.

## 8. Server routes (Next.js)

- `POST /api/sepolia` — same-origin JSON-RPC proxy for the browser's live title reads, so no public RPC's CORS behaviour can break the deal page (found in E2E: a rate-limit response without CORS headers). Read-only method allowlist (`eth_call`, `eth_blockNumber`, `eth_getTransactionReceipt`, …); `eth_sendRawTransaction` and other writes are refused (403). Upstreams in order: `SEPOLIA_RPC_SERVER` (server-only, optional), `NEXT_PUBLIC_SEPOLIA_RPC`, `NEXT_PUBLIC_SEPOLIA_RPC_FALLBACK`. The browser falls back to the public RPCs directly only if the proxy fails.
- No document-check route (NEAR AI Cloud cut, S-09). No relayer route yet.

## 9. Testing

- Unit: shared module (derived address, explorer URLs, state→label mapping).
- Component: deal page for every state, both modes, light and dark.
- E2E (Playwright): judge view of `/demo` renders links; settled deal shows seal; refunded deal shows return state.

## 10. Demo mode

`/demo` reads deal ids from `DEPLOYMENTS.md`-backed config. No wallet needed. It is the page linked from the README and the X post.
