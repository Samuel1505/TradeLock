# CLAUDE.md — Tradelock

This file is the primary briefing for Claude Code working in this repository. Read it fully before writing code. When it conflicts with an assumption you hold about NEAR, TradeTrust, or any API, this file wins on *intent* and the official docs win on *interface*: verify every endpoint, method signature, contract address and SDK version against current docs before using it (see §13).

---

## 1. What we are building

**Tradelock** — *Goods for money, released together. No bank needed.*

Tradelock is bankless **documents-against-payment** (D/P) for cross-border trade. A buyer and a supplier in different countries lock both sides of a trade in one deal:

- the **cash leg**: the buyer's stablecoins, held by the Tradelock contract on NEAR via NEAR Intents;
- the **title leg**: the supplier's **electronic bill of lading (eBL)** — the legal document of title to the shipped goods — held on an EVM chain (Sepolia for the demo) by an address the Tradelock contract controls through **NEAR Chain Signatures (MPC)**.

When delivery is confirmed, the contract releases both legs: stablecoins to the supplier, title to the buyer. If the deal fails, both legs return to their original owners. The cash leg is public in this build (testnet, Standard rail); Confidential Intents is a mainnet-only design target, not built (S-08).

For trades with no eBL, the same deal runs in **escrow-only mode**: cash leg only, release on confirmed delivery.

### The one sentence everything leads with

> The buyer only gets the goods when the seller gets paid — and no bank is needed.

Use this (or a close variant) as the first line of the README, the demo video, and the submission description.

### Why this exists (real demand)

- In cross-border trade neither side wants to go first. Banks solve it with letters of credit and documentary collections (holding the bill of lading until the buyer pays). That service is slow, expensive, and frequently denied to small businesses (ADB: SME trade finance applications rejected ~41% of the time; global trade finance gap ~$2.5T).
- Small traders who skip banks either prepay and hope, or send stablecoins that are final and public — exposing suppliers, volumes and balances to competitors.
- eBLs are now legal title in MLETR jurisdictions (UK ETDA 2023, Singapore, Bahrain, France, and others), and TradeTrust (Singapore IMDA's open framework) already represents eBLs as NFTs on Ethereum/Polygon/XDC. Settling them against payment still runs through banks. Tradelock replaces that bank step.

### What makes it novel

A NEAR contract holds **legally recognized title to physical goods on another chain** through an MPC-derived address, and transfers it under its own rules, in the same deal that holds the payment. This is the showcase moment. Nothing else in the project matters as much.

### Positioning against NEAR Business

NEAR Business (launched 20 Oct 2026) is a confidential multisig *treasury* for crypto-native teams: approve-then-send, every party on the same side. Tradelock is *conditional, two-party settlement* between counterparties who don't trust each other, exchanging payment for title. Same architecture family (multisig approvals → MPC signing → Confidential Intents settlement), different job, different users (businesses that ship physical goods).

> NEAR Business holds the treasury. Tradelock trades it — for goods, with strangers.

Never describe Tradelock as competing with or "beating" NEAR Business.

### Hackathon context

- Event: NEAR HACKATHON (https://nearhackathon.com). Live rules: https://nearhackathon.com/HACKATHON.md — re-read before submission.
- Track: `realworld` (Real-World Money) only. The privacy track is dropped (2026-11-04): Confidential Intents, NEAR AI Cloud and the Shade Agent are all cut (S-08, S-09, S-10).
- Jury includes NEAR's co-founder, crypto investors, and **AI judges (Claude Code and Codex) that read the repository**. The README must be followable by a machine as "do X → see Y" steps. No marketing.
- Judging dimensions used by past NEAR hackathons: technical implementation, design, impact, originality, sustainability.

---

## 2. Working principles for Claude Code in this repo

1. **Treat every run as if it will succeed.** Before any attempt, consult the best available information (docs, source, ABIs, existing code). Do not launch an attempt you expect to throw away. When something fails, learn from it and fix the cause.
2. That is an *effort posture*, not an architecture choice: all systems still get **full error handling, retries, idempotency, and explicit failure paths.**
3. **Mechanism level, not category level.** Name the exact method, account, payload, state transition. No hand-waving like "integrate with Intents."
4. **Never silently mock.** If a real dependency is unavailable, use the closest real alternative and record the substitution in `docs/SUBSTITUTIONS.md` and the README. Mocks are allowed only inside tests and must be named `Mock*`.
5. **Brief and direct** in commit messages, comments and summaries. No over-explanation.
6. **Verify before assuming** (§13). If a doc and this file disagree on an interface, follow the doc and note the discrepancy in `docs/DECISIONS.md`.

### Never without the human's explicit confirmation

- Deploying to NEAR mainnet, signing mainnet transactions, or spending real tokens (D-018: no mainnet at all).
- Any testnet transaction (deploy, call, transfer): show the exact command first and wait for confirmation.
- Pushing, force-pushing, or making the repository public.
- Posting anything anywhere, or sending the hackathon submission.
- Committing secrets. Keys live in environment variables only; commit `.env.example` with placeholder names.

---

## 3. Architecture

```
                         ┌──────────────────────────────┐
   Buyer (NEAR acct) ──► │  tradelock contract (NEAR)   │ ◄── Supplier (NEAR acct + EVM wallet)
   funds via Intents     │  - deal state machine        │
                         │  - 2-of-3 votes per deal     │ ◄── Arbiter (NEAR acct)
                         │  - timeouts                  │
                         └──────┬───────────────┬───────┘
              cash leg          │               │        title leg
       ┌────────────────────────▼──┐        ┌───▼─────────────────────────────┐
       │ intents.near (Verifier)   │        │ v1.signer (MPC, Chain Sigs)     │
       │ NEP-245 internal balances │        │ signs EIP-1559 tx payloads for  │
       │ (+ Confidential Intents)  │        │ the deal's derived EVM address  │
       └───────────────────────────┘        └───┬─────────────────────────────┘
                                                │ signed tx, broadcast by executor
                                            ┌───▼─────────────────────────────┐
                                            │ Sepolia: TradeTrust registry +  │
                                            │ TitleEscrow (holder/beneficiary)│
                                            └─────────────────────────────────┘
       ┌────────────────────────────────────────────────────────────────────┐
       │ Shade Agent — CUT (D-019, S-10). Facts below are party-confirmed     │
       │  - watches Sepolia: confirms TitleEscrow holder+beneficiary == deal │
       │    address; confirms title transfer txs landed                      │
       │  - watches carrier tracking: confirms arrival / discharge           │
       │  - calls agent contract → which calls tradelock (agent-gated)       │
       └────────────────────────────────────────────────────────────────────┘
       NEAR AI Cloud (TEE inference): invoice/packing list vs order check — advisory only
       Relayer (meta transactions, NEP-366): pays NEAR gas for buyer/supplier/arbiter actions
       Web app: deal creation, acceptance, funding, status, dispute, explorer links
```

### Network layout (important)

**Everything runs on NEAR testnet + Sepolia (DECISIONS D-018, supersedes D-003). No mainnet.**

- `tradelock` contract → NEAR **testnet**, account `tradelock.samuelowen.testnet` (contract account and MPC predecessor). Parent account `samuelowen.testnet`.
- MPC → `v1.signer-prod.testnet` (v3.18.0; same sign interface as mainnet 3.17.0, DECISIONS V-01). **MPC signs payloads, not chains**: a testnet MPC signature over a Sepolia tx hash (chain id 11155111 inside the signed tx) is a valid Sepolia signature.
- Title leg → **Sepolia**, real TradeTrust 5.5.2 contracts (official factory + our registry).
- Cash leg → testnet. `intents.near` has no testnet deployment; the Standard CashRail uses our own testnet instance of the Verifier or a NEP-141 escrow (DECISIONS V-16, SUBSTITUTIONS S-07). Confidential Intents is mainnet-only and cut (S-08); the design is documented, not claimed.
- `samuelowen.near` (mainnet) is the prize-payout account only. Never deploy to it, sign with it, or reference it in code.
- Development and CI: `near-workspaces` sandbox with `Mock*` contracts **inside tests only**.
- **First integration test of the project:** a `v1.signer-prod.testnet` signature, requested by our contract for a derived path, produces a Sepolia tx that Sepolia accepts.

---

## 4. Components and repository layout

```
/contracts
  /tradelock          Rust, near-sdk. Deal state machine, votes, timeouts, Intents + MPC calls.
  /tradelock-agent    CUT (D-019). Not built.
/agent                CUT (D-019); placeholder only. Executor logic lives in /scripts (any party may run it). Was: Shade Agent worker — Sepolia + carrier watchers,
                      tx builder/broadcaster for the title leg.
/evm                  Foundry or Hardhat. TradeTrust token-registry deploy + mint scripts (Sepolia).
/relayer              TypeScript. NEP-366 meta-transaction relayer.
/web                  Next.js + TypeScript. NEAR wallet selector, viem for EVM reads/supplier actions.
/scripts              End-to-end demo runner (seeded deal, full flow, prints explorer links).
/docs
  ARCHITECTURE.md     Deeper design, sequence diagrams.
  CONTRACTS.md        Contract structure, storage, methods, errors, gas, tests.
  NEAR_INTEGRATION.md Each NEAR primitive: job, exact flow, verification, failure modes.
  FRONTEND.md         Routes, role flows, deal page, copy, design tokens, tests.
  STATE_MACHINE.md    Full transition table (mirror of §5, kept in sync with code).
  THREAT_MODEL.md     §10, expanded.
  DECISIONS.md        Decisions + discrepancies found during verification.
  SUBSTITUTIONS.md    Any real dependency replaced, and why.
  DEPLOYMENTS.md      Addresses, token IDs, tx hashes, explorer links for the demo run.
README.md             For humans AND AI judges. See §11.
.env.example          Every variable, placeholder values only.
```

Keep one source of truth for shared types (deal IDs, states, derivation path format) and generate TS types from the contract ABI where possible.

---

## 5. Deal state machine (core of the contract)

Design rule: **every transition is idempotent and resumable from stored state.** A failed MPC signature, a dropped Sepolia tx, a failed Intents transfer, or a crashed agent must never leave a deal half-settled. Any party (or the agent/executor) can re-trigger the pending step; re-triggering a completed step is a no-op.

### States

| State | Meaning |
|---|---|
| `Created` | Buyer proposed terms. Awaiting supplier acceptance. |
| `Funded` | Supplier accepted and buyer's payment is held in the contract's Intents balance. |
| `TitleHeld` | Confirmed (D-019: buyer, or supplier + arbiter) that the deal's derived EVM address is both holder and beneficiary of the eBL's TitleEscrow. Documents presented; buyer accepts or refuses before `accept_by` (D-020). (eBL only.) |
| `Delivered` | Escrow-only only, transient: buyer confirmed delivery → `Settling` in the same call. Not used in eBL mode (D-020). |
| `Settling` | In-flight: paying supplier and transferring title to buyer. Tracks each leg separately. |
| `Settled` | Both legs confirmed. Terminal. |
| `Disputed` | A party raised a dispute. Awaiting 2-of-3 resolution. |
| `Refunding` | In-flight: returning cash to buyer and title to supplier. |
| `Refunded` | Both legs returned. Terminal. |
| `Cancelled` | Never funded (supplier declined, buyer withdrew, or acceptance window expired). Terminal. |

`Settling` and `Refunding` exist purely to make the two-leg release resumable. Each holds a `LegProgress` per leg:

```
CashLeg:  Pending | TransferRequested | Done
TitleLeg: Pending | SignatureRequested{nonce} | Signed{nonce, sig} | Broadcast{nonce, tx_hash} | Done{tx_hash} | NotApplicable
```

A deal leaves `Settling` for `Settled` (or `Refunding` for `Refunded`) only when both legs are `Done`/`NotApplicable`.

### Transitions

**Authoritative table: `docs/STATE_MACHINE.md` §5** (D-019 confirmations, D-020 documents-against-payment, D-021). Summary:

| From | To | Trigger | Guard |
|---|---|---|---|
| — | `Created` | `create_deal` (buyer) | valid terms; parties distinct |
| `Created` | `Cancelled` | `decline` / `withdraw` / acceptance timeout | not funded |
| `Created` | `Funded` | `accept_deal`, then `mt_on_transfer(msg={deal_id})` from the Verifier | exact token + amount; mismatch refunded |
| `Funded` | `TitleHeld` | `confirm_title_held` (buyer, or supplier + arbiter) | eBL; before `ship_by` |
| `TitleHeld` | `Settling` | `accept_documents` (buyer) before `accept_by`, or `release` (anyone) after it | — |
| `TitleHeld` | `Refunding` | `refuse_documents` (buyer) | before `accept_by` |
| `Funded` (escrow-only) | `Settling` | `confirm_delivery` (buyer) | before `deliver_by` |
| `Funded` / `TitleHeld` | `Disputed` | `dispute` (buyer or supplier) | once per deal |
| `Disputed` | `Settling` / `Refunding` | 2-of-3 votes `Release` / `Refund` | Release needs title held (eBL) |
| `Funded` | `Refunding` | `claim_timeout` (buyer) | eBL past `ship_by`; escrow-only past `deliver_by` |
| `Settling` / `Refunding` | `Settled` / `Refunded` | both legs `Done`/`NotApplicable` | — |

Rules:
- Votes: each of buyer, supplier, arbiter has one vote per dispute; a vote can be changed until the threshold is reached; reaching 2 identical votes executes immediately.
- Once `Settling` or `Refunding` starts, no dispute or vote can change direction.
- Timeouts are enforced on-chain against `env::block_timestamp()`; no off-chain clock is trusted.
- Every state change emits a NEP-297 event (`standard: "tradelock"`) with deal id, from, to, and leg progress. The web app and demo script read these.

### Deal data model (sketch — adjust to near-sdk storage best practice)

```rust
struct Deal {
    id: u64,
    buyer: AccountId,
    supplier: AccountId,
    arbiter: AccountId,
    token_id: String,            // Intents token id, e.g. "nep141:<usdc contract>"
    amount: U128,
    title_mode: TitleMode,       // Ebl { registry, token_id, chain_id } | None
    supplier_evm: Option<String>,// supplier's EVM address (title returns here on refund)
    buyer_evm: Option<String>,   // buyer's EVM address (title goes here on settle)
    payout: PayoutTarget,        // Intents internal transfer to supplier account, or withdraw to chain/address
    ship_by: u64, deliver_by: u64,
    order_hash: [u8; 32],        // hash of the order/terms document (never the contents)
    state: DealState,
    cash_leg: CashLeg, title_leg: TitleLeg,
    votes: Votes,
}
```

Store document **hashes** only. No commercial contents on-chain.

---

## 6. Title leg — Chain Signatures + TradeTrust (BUILD FIRST)

This is the showcase. Prove it end to end before building anything else.

### Milestone T1 (the proof)

1. Deploy TradeTrust token-registry contracts on Sepolia (`@tradetrust-tt/token-registry@5.5.2`; factory choice in DECISIONS D-014). We act as the "carrier" (minter) for the demo — this is a disclosed substitution; the contracts are the real TradeTrust contracts.
2. Mint an eBL. Minting creates a TitleEscrow that owns the token; holder and beneficiary are managed on the TitleEscrow (`registry.ownerOf(tokenId)` returns the TitleEscrow address).
3. Transfer holder and beneficiary to the deal's **MPC-derived EVM address**.
4. From the `tradelock` contract, request an MPC signature for a tx that transfers holder and beneficiary to a buyer address; broadcast it; confirm on Etherscan.

### Derivation

- Path format: `tradelock/deal/{deal_id}` — one fresh EVM address per deal, so deals cannot be clustered on Sepolia.
- The derived address is a function of the MPC root public key (domain 0), the **predecessor account** (the `tradelock` contract account), and the path. Compute it off-chain with `chainsig.js@1.1.16` (`utils.cryptography.deriveChildPublicKey`); verify in a test against `v1.signer.derived_public_key({path, predecessor, domain_id: 0})` and against the signer recovered from a real MPC signature (DECISIONS V-03).
- The contract stores each deal's derived address (D-013): at `create_deal` it cross-calls `v1.signer.derived_public_key`; the callback decodes the uncompressed 64-byte key and stores `keccak256(x‖y)[12..]` (`env::keccak256_array`, no curve math). Evidence is checked only against this stored address; never accept the address from a caller.
- The signature callback stores a signature only if `env::ecrecover` yields the stored derived address (D-016).

### Who builds the EVM transaction (security-critical)

The contract must never sign an arbitrary payload supplied by a caller. Instead:

- The contract **constructs the transaction itself** for the specific deal: `to` = TitleEscrow address stored in the deal, `data` = the encoded TitleEscrow transfer call with the stored buyer (settle) or supplier (refund) address, `value` = 0, `chain_id` = stored chain id.
- The executor (any party running `scripts/`; untrusted) supplies only `nonce`, `max_fee_per_gas`, `max_priority_fee_per_gas`, `gas_limit`. The contract bounds these.
- Use `omni-transaction = 0.5.0` (`default-features = false, features = ["evm"]`) to RLP-encode the EIP-1559 tx inside the contract (`build_for_signing()` = `0x02 ‖ rlp(fields)`) and hash it with `env::keccak256_array`. Do not use the crate's `build_with_signature`; the executor assembles the signed tx with viem (DECISIONS V-04).
- The contract calls `v1.signer.sign({"request":{"path","payload_v2":{"Ecdsa":"<hex32>"},"domain_id":0}})` with ≥ 15 Tgas on that receipt and exactly the MPC deposit (1 yoctoNEAR today). `v1.signer` refunds any excess to *its predecessor* — our contract — so `tradelock` forwards exactly `config.mpc_sign_deposit` and refunds the caller's excess itself. Deposit and gas are owner-updatable config (DECISIONS V-01, D-012).
- The response is `{"scheme":"Secp256k1","big_r":{"affine_point":"<hex33>"},"s":{"scalar":"<hex32>"},"recovery_id":0|1}`, low-s normalized: `r = big_r[1..33]`, `yParity = recovery_id`. On the signature callback, store `Signed{nonce, sig}`. The executor assembles and broadcasts the signed tx, then reports `Broadcast{tx_hash}`. The recipient (or the other two parties, D-019) confirms the resulting TitleEscrow holder/beneficiary, then the contract marks the title leg `Done`.

### Idempotency and retries

- Re-signing with the **same nonce** is safe: at most one tx with that nonce can land. Bumping fees = re-request signature with same nonce, new fee fields.
- If a different tx consumed the nonce (should never happen; the address is only controlled by this contract), a party confirms the actual on-chain holder state and the contract reconciles from it.
- The title leg is `Done` only on confirmed on-chain state (D-019), never on "tx sent."

### TradeTrust specifics (verified against `@tradetrust-tt/token-registry@5.5.2`, DECISIONS V-09/V-10)

- One call moves both roles: `TitleEscrow.transferOwners(address _nominee, address newHolder, bytes _remark)` (selector `0x34427f61`), callable by the holder; no nomination step when holder == beneficiary. The contract encodes `transferOwners(dest, dest, 0x)`. The supplier hands title in with the same call: `transferOwners(dealAddr, dealAddr, 0x)`.
- Mint: `registry.mint(beneficiary, holder, tokenId, remark)` with `MINTER_ROLE`; `registry.ownerOf(tokenId)` is the TitleEscrow. Remarks ≤ 120 bytes; we pass empty bytes.
- Rejection: the recipient of `transferOwners` can call `rejectTransferOwners` and return both roles to the deal address, even after the deal is terminal. Handled by `redeliver_title` (D-015): terminal state only; buyer after `Settled`, supplier after `Refunded`; only after the title is confirmed back at the deal address (D-019: entitled party alone, or the other two); destination = stored address; separate redelivery sub-leg; deal state stays terminal.
- The registry admin can `pause` the registry, freezing all title transfers (THREAT_MODEL T14).
- Gas: the derived address needs Sepolia ETH to send its own txs. A funder tops it up before signing. Note in the threat model: funding from one funder account links deal addresses; mitigate later (e.g., gas sponsorship), disclose now.

---

## 7. Cash leg — NEAR Intents (+ Confidential Intents)

### Receiving payment

- The Verifier `intents.near` holds all assets as NEP-245 internal balances; token ids are prefixed (`nep141:…`, `nep171:…`, `nep245:…`).
- Buyer funds the deal by transferring the agreed token inside the Verifier to the `tradelock` contract with `mt_transfer_call` (msg = deal id). `tradelock.mt_on_transfer` validates sender, token id and amount against the deal and returns the amount to refund. Verify the Verifier's NEP-245 `mt_transfer_call` support and callback shape in `near/intents` before implementing; if unsupported, use deposit with `msg` routing ownership to the contract and an explicit `fund_deal` step.
- Buyers on other chains reach this via the 1Click API / Intents deposit flow into their Intents balance first; the web app guides this.

### Paying out / refunding

- Settle: contract transfers the deal amount from its Verifier balance to the supplier — internal transfer to the supplier's NEAR account, or a withdrawal to the supplier's chosen chain/address (verify the Verifier's withdrawal method and memo format for each target chain).
- Refund: same, to the buyer.
- Mark `CashLeg::Done` only in the success callback; on failure stay `TransferRequested` and allow retry.
- Settle in the deposited stablecoin. Token/chain conversion for the supplier is a stretch goal (needs solver quotes); do not block on it.

### Confidential Intents — CUT (mainnet-only, D-018, S-08). Design reference only.

- Goal: deposits and payouts routed through the confidential shard so buyer and supplier cannot be linked on-chain; approvals and state transitions stay publicly verifiable.
- NEAR Business proves a contract-governed treasury can hold confidential balances. Builder access may need enablement (an "invite-only" response has been reported). Verify access early; integrate behind a `CashRail` abstraction with `Standard` and `Confidential` implementations so the state machine is identical either way.
- Be precise in all copy: confidentiality = unlinkability of deposit and withdrawal. The destination-chain payout itself is visible on that chain.

---

## 8. Shade Agent — CUT (2026-11-04, D-019, SUBSTITUTIONS S-10)

Not built: Phala Cloud needs a card, the framework is unmaintained since 2026-04-19, and local mode verifies no attestation (V-17). Title and delivery facts are confirmed by the parties per D-019; anyone can re-check title facts on Sepolia. The original design is kept below for reference only.


One TEE-attested worker replaces trust in humans for the happy path. It attests **two kinds of facts**:

1. **Title facts (Sepolia):** the TitleEscrow for the deal's token has holder == beneficiary == deal address → `confirm_title_held`; later, the settle/refund tx landed and holder/beneficiary now equal the buyer/supplier → title leg `Done`.
2. **Delivery facts (carrier):** the container/bill of lading shows arrival or discharge at the destination port → `confirm_arrival`.

Mechanism:
- Built with the Shade Agent Framework (`@neardefi/shade-agent-js`), deployed to Phala Cloud (Dstack). The agent contract verifies the TEE attestation at `register_agent` and only allows valid agents (approved measurements/code hash, unexpired registration) to call agent-gated methods.
- `tradelock-agent` = the reference agent contract extended with agent-gated methods that cross-call `tradelock`. `tradelock` accepts `confirm_*` calls **only** from the `tradelock-agent` account.
- Multiple agent instances may run: every report must be idempotent (same deal, same fact → no-op).
- Evidence payloads carry block numbers / tx hashes / carrier event ids so anyone can re-check them.

### Carrier data source — verify access before building

- Prefer a real carrier tracking API (DCSA Track & Trace–style). These typically need registration. Check access first.
- If no carrier feed is obtainable, use the closest **real** data source you can access and record it in `docs/SUBSTITUTIONS.md` and the README. Never present simulated tracking as real.
- Agent cut fallback: buyer confirms delivery via `confirm_delivery`.

---

## 9. NEAR AI Cloud document check — CUT (2026-11-04, SUBSTITUTIONS S-09; no credits)

Kept for reference only. Do not build unless the human re-approves spend.

- OpenAI-compatible API; inference runs in TEEs. Compare the uploaded commercial invoice / packing list against the agreed order (quantities, unit prices, totals, descriptions, parties) and return structured mismatches.
- **Advisory only**: it never gates a state transition. Store only the hash of the result on-chain (optional).
- Verify and display the TEE attestation in the UI using NEAR AI's verifier tooling (`github.com/nearai/cloud-api` and docs at docs.near.ai). A "verified private" badge must be backed by a real verification, or not shown.
- Uploaded documents in the demo are synthetic. Never use real commercial documents.

---

## 10. Relayer, web app, privacy, threat model

### Relayer (meta transactions)
- NEP-366 delegate actions; a relayer account pays NEAR gas so buyer, supplier and arbiter never need NEAR for gas. Restrict the relayer to calls on `tradelock` methods only, with per-account rate limits.

### Web app
- Pages: create deal, deal detail (state, legs, events, explorer links), accept/decline, fund, dispute/vote, timeout claim, document check.
- Every on-chain fact shown with a link: NEAR explorer for contract txs, Etherscan (Sepolia) for title transfers.
- Must support light and dark mode; mobile-friendly.

### What is private and what is not (state this exactly in README and THREAT_MODEL.md)
- Private: document contents (only hashes stored); cargo details.
- Public in this build: cash-leg amounts and counterparties (Standard rail; Confidential Intents cut).
- Public: that a deal exists and its state transitions/votes on NEAR (by design — verifiable governance); that a TradeTrust title transfer happened on Sepolia (per-deal addresses prevent clustering; funder linkage is a known leak, see §6).

### Threat model highlights
- Caller-supplied payload signing → prevented by in-contract tx construction (§6).
- Fake delivery or title reports → confirmed only by the party a false report would hurt, or by the other two parties together (D-019); evidence re-checkable on Sepolia.
- Stuck settlement → resumable legs, anyone can re-trigger.
- Arbiter collusion → arbiter alone cannot move funds; needs one party; timeouts protect against a silent party.
- Off-chain reality gap → parties confirm what they observe; nothing verifies physical delivery; disputes go to 2-of-3.
- Cross-chain atomicity → **not atomic**. It is an orchestrated two-leg settlement where the contract holds both assets before either moves. Never claim atomicity across chains.

### Known limitations (must appear in README)
- eBL adoption is early (~13% of bills of lading in 2025; ~11 MLETR jurisdictions). Escrow-only mode is what works for most trade today; title-for-cash is where trade is going.
- **Open legal question:** whether an address controlled by a 2-of-3 NEAR contract via MPC satisfies MLETR "exclusive control." Present as a question the design raises. Never claim legal validity.
- Carrier role simulated in the demo (we mint the eBL on our own TradeTrust registry deployment).
- No fiat on/off-ramp, no KYC, no production key management, no regulatory/licensing claims.

---

## 11. README requirements (written for AI judges and humans)

Order:
1. The one sentence (§1).
2. Problem (3–4 lines, with the ADB figures) → what Tradelock does (5 lines).
3. **Try it:** numbered "do X → see Y" steps from a clean checkout: install, set env from `.env.example`, run the seeded demo script, open the printed links, see the deal reach `Settled` with the payout tx and the Sepolia title-transfer tx.
4. Deployed addresses, demo token id, and explorer links for one completed settlement (from `docs/DEPLOYMENTS.md`).
5. **How it uses NEAR** — one line per primitive with the exact job:
   - SputnikDAO-style 2-of-3 approvals (implemented natively in `tradelock`; say so accurately)
   - Chain Signatures / MPC (`v1.signer`) — controls title on Sepolia
   - NEAR Intents (`intents.near`) — holds and pays out the cash leg
   - (cut, say so: Confidential Intents, Shade Agents, NEAR AI Cloud — S-08/S-09/S-10)
   - Meta transactions — gasless actions via relayer
6. Why this is only possible on NEAR: a contract holding title to goods on another chain through MPC, settled against payment in the same deal.
7. Architecture diagram (two legs converging on one contract).
8. State machine summary + link to `docs/STATE_MACHINE.md`.
9. Privacy: what's private and what isn't (factual statement, no track framing). Threat model link.
9a. How anyone verifies title state on Sepolia directly: TitleEscrow `holder()` / `beneficiary()`, explorer link per deal.
10. Known limitations and substitutions.
11. Tests: how to run, what they cover.
12. Roadmap (short): fully confidential title leg, receivables financing on funded title-backed deals, NEAR Business treasury integration.

Name the track hints used (HACKATHON.md asks for this): realworld → Stablecoins, NEAR Intents, Meta Transactions. No privacy track.

---

## 12. Build order, testing, demo

### Build order (strict)
1. **T1 — title leg proof** (§6): TradeTrust on Sepolia, eBL to derived address, contract-requested MPC signature moves it out. Includes the testnet-MPC-signs-Sepolia-tx check.
2. **State machine + cash leg** (§5, §7): full transitions with `near-workspaces` tests; Standard CashRail receive/pay/refund on testnet (V-16).
3. ~~Shade Agent~~ — cut (D-019, S-10). Party confirmations per D-019 are built in step 2.
4. ~~Confidential Intents~~ — cut (mainnet-only, D-018). Design documented in NEAR_INTEGRATION §3; not claimed.
5. **Relayer + web app.**
6. ~~NEAR AI Cloud document check~~ — cut (S-09).
7. README, docs, demo script, recorded run.

### Cut order if something stalls
Already cut (2026-11-04): NEAR AI Cloud document check (S-09), Confidential settlement (S-08), Shade Agent (S-10).
Next if something stalls: the relayer (users pay their own testnet gas), then the web app's non-deal pages.
**Never cut the title leg.** It is the reason the project gets showcased.

### Tests (required)
- Contract: one test per transition in §5, including every guard failure; idempotency tests (re-trigger each in-flight step twice); timeout tests; vote tests (2-of-3 both directions, vote changes before threshold); `mt_on_transfer` amount/token mismatch refunds.
- Derivation: contract-side and JS-side derived address match.
- Tx construction: in-contract RLP/keccak payload matches an ethers/viem reference for the same fields.
- EVM: TradeTrust mint and transfer scripts against a local chain and Sepolia.
- E2E: `scripts/demo` runs the seeded deal to `Settled` and to `Refunded`, printing explorer links.

### Demo (90 seconds, recorded + live link)
- 0–10s: the problem in one line.
- 10–25s: a deal created and funded.
- 25–40s: the eBL moving to the deal address on Etherscan.
- 40–55s: title held confirmed by the buyer (checked on Etherscan), delivery confirmed by the buyer.
- 55–75s: both legs settling — payout tx and Sepolia title transfer shown on explorers.
- 75–90s: the one-line close (§1).

Seed data is synthetic. `docs/DEPLOYMENTS.md` records every address, token id and tx hash from the recorded run.

---

## 13. Verify before you build (do not assume these)

Check each against current official docs/source and record findings in `docs/DECISIONS.md`:

- [x] `v1.signer` `sign` request shape (payload format, path, key/domain id for secp256k1), required deposit, gas, and callback/return format. Docs: https://docs.near.org/chain-abstraction/chain-signatures
- [x] MPC (`v1.signer-prod.testnet`, D-018) signature accepted for a Sepolia tx from a derived address (V-02, T1 done 2026-11-04).
- [x] Derived-address computation library and version.
- [x] In-contract EIP-1559 tx building crate and API.
- [ ] Verifier (`intents.near`): NEP-245 `mt_transfer_call` support, `mt_on_transfer` shape, internal transfer and withdrawal methods, token ids for the chosen stablecoin. Source: https://github.com/near/intents, docs: https://docs.near-intents.org/
- [—] Confidential Intents — not needed (mainnet-only, cut).
- [x] TradeTrust token-registry v5: TitleEscrow method names/params, minting roles, Sepolia support. Source: https://github.com/TradeTrust/token-registry
- [x] Shade Agent Framework / Phala (V-11, V-17) → cut (D-019).
- [—] Carrier tracking data source access — not needed (agent cut).
- [x] NEAR AI Cloud API, credits, attestation verification (V-13: no free credits → cut, S-09). Docs: https://docs.near.ai/
- [ ] NEP-366 relayer reference implementation.

---

## 14. Glossary

- **Bill of lading (B/L):** issued by the carrier; receipt for goods, evidence of the carriage contract, and **document of title** — whoever holds it can claim the cargo.
- **eBL:** electronic B/L with the same legal function where MLETR-style law applies.
- **MLETR:** UNCITRAL Model Law on Electronic Transferable Records (2017); requires singularity, exclusive control, integrity.
- **Documents against payment (D/P):** banks release the shipping documents (title) to the buyer only on payment. Tradelock does this without a bank.
- **TradeTrust:** Singapore IMDA's open-source framework; eBLs as NFTs in a token registry, each owned by a **TitleEscrow** contract with a **holder** (possession) and **beneficiary** (ownership).
- **Derivation path:** string that, with the predecessor account, determines which foreign-chain address the MPC network signs for.
- **Verifier (`intents.near`):** NEAR Intents settlement contract; holds assets as NEP-245 balances; settles matched intents atomically within NEAR.
- **Shade Agent:** worker running in a TEE whose attestation is verified on-chain by an agent contract, which gates privileged methods.

---

## 15. Submission (human-driven)

- One submission per team, cannot be edited; project name and email must be unique.
- Repository public, demo post on X (states it was built at NEAR HACKATHON, video attached).
- Tracks: `["realworld"]`.
- Description (20–2000 chars): problem, product, how NEAR fits.
- Follow HACKATHON.md exactly: build the payload from the human's answers, print it, send only after explicit confirmation, reuse the same `requestId` on retry, never fill the `website` field.
