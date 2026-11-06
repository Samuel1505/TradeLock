# STATE_MACHINE.md — Tradelock deal lifecycle

Authoritative specification of the deal state machine. Code in `contracts/tradelock` must match this file; any change updates both in the same commit. Supersedes CLAUDE.md §5 where they differ (D-019, D-020, D-021).

---

## 1. Design rules

1. **Idempotent.** Calling any method twice with the same inputs produces the same end state. A completed step re-triggered is a no-op.
2. **Resumable.** All progress is stored on-chain. A failed callback or dropped tx resumes from stored state (`resume`, `request_title_signature`).
3. **Two legs, tracked separately.** In-flight states (`Settling`, `Refunding`) hold per-leg progress; terminal only when both legs complete.
4. **Confirmed completion.** The title leg completes only on confirmed on-chain state (§5a), never on "tx sent."
5. **No direction change once in flight.** After entering `Settling` or `Refunding`, disputes, votes, refusals and timeouts are rejected.
6. **On-chain time only.** Deadlines compare against `env::block_timestamp()`.
7. **Events for everything.** Every transition and leg-progress change emits a NEP-297 event.
8. **Documents against payment (D-020).** In eBL mode the deal exchanges title for payment; it never waits for physical delivery. The bill of lading is control of the goods; the buyer collects the cargo with it.

---

## 2. Modes and deadlines

| Mode | Deadlines in terms | Meaning |
|---|---|---|
| eBL (`title_mode = Ebl`) | `ship_by` (absolute, ns) | Title must be confirmed held by the deal address before this, or the buyer may reclaim the cash |
| | `doc_acceptance_window_ns` (duration) | Starts when the deal enters `TitleHeld`: `accept_by = title_held_at + window`. Buyer accepts or refuses the documents before `accept_by`; after it, anyone may `release` |
| Escrow-only (`title_mode = None`) | `deliver_by` (absolute, ns) | Buyer confirms delivery before this, or may reclaim the cash (supplier disputes first if the buyer withholds, T4) |
| Both | `config.acceptance_window_ns` | Supplier must accept within this window after `create_deal` |

## 3. States

| State | Terminal | Description |
|---|---|---|
| `Created` | no | Buyer proposed terms; awaiting supplier acceptance, then funding. Flag `accepted` |
| `Funded` | no | Cash held in the contract's Verifier balance |
| `TitleHeld` | no | eBL only: holder = beneficiary = deal-derived address (confirmed, §5a). Documents presented; `accept_by` running |
| `Settling` | no | Paying supplier + transferring title to buyer |
| `Settled` | yes | Both legs complete toward supplier/buyer |
| `Disputed` | no | Awaiting 2-of-3 decision |
| `Refunding` | no | Returning cash to buyer + title to supplier (if held) |
| `Refunded` | yes | Both legs returned |
| `Cancelled` | yes | Never funded |

`Delivered` is not a stored state: in escrow-only mode `confirm_delivery` emits `delivered` and enters `Settling` in the same call. It does not exist in eBL mode (D-020).

---

## 4. Leg sub-states

### Cash leg
```
Pending ──transfer issued──► TransferRequested ──success callback──► Done
   ▲                                │
   └────────failure callback────────┘          (resume re-issues)
```
Payout to supplier: `mt_transfer` inside the Verifier, or `ft_withdraw` to the supplier's NEAR account (payout target in terms). Refund to buyer: `mt_transfer` back to the buyer's Verifier balance.

### Title leg
```
NotApplicable                               (escrow-only, or refund when title was never confirmed held)

Pending | Signed | Broadcast ──request_title_signature(nonce, fees)──► SignatureRequested{nonce}
SignatureRequested ──sign callback ok, ecrecover == derived address──► Signed{nonce, sig}
SignatureRequested ──sign callback err/timeout/bad signature──► Pending
Signed ──report_broadcast(tx_hash)──► Broadcast{nonce, tx_hash}      (anyone; informational)
Pending | SignatureRequested | Signed | Broadcast ──title transferred confirmed (§5a)──► Done
```
`dest` = `buyer_evm` in `Settling`, `supplier_evm` in `Refunding`. Any nonce may be requested whenever no request is in flight (D-021): every signature for a leg encodes the same `transferOwners(dest, dest, 0x)` on the same TitleEscrow, so stale signatures can at most fail on-chain (`RecipientAlreadyHolder`) and cost the broadcaster gas. This replaces the earlier "reconcile" path.

### Redelivery sub-leg (D-015)
TradeTrust lets the recipient call `rejectTransferOwners`, returning holder+beneficiary to the deal address after the deal is terminal. `redelivery: Option<TitleLeg>` handles this without leaving the terminal state:
```
None | Some(Done) ──title at deal address confirmed (§5a)──► Some(Pending), awaiting redeliver_title
Some(Pending) ──redeliver_title(deal_id)──► requested; then the title-leg flow above → Done
```
After `Refunded` this also recovers a title the supplier handed over that nobody confirmed before a `ship_by` refund. Destination is always the stored address for the terminal state; `redeliver_title` takes no address (D-002).

---

## 5. Transition table

| # | From | To | Method | Caller | Guards | Side effects |
|---|---|---|---|---|---|---|
| 1 | — | `Created` | `create_deal(terms)` (payable: storage) | buyer | buyer, supplier, arbiter distinct; amount > 0; token allowlisted; not paused. eBL: registry in the registry → factory allowlist (D-021), registry, token id, `buyer_evm`, `supplier_evm` non-zero and ≠, `ship_by` in future, window within config bounds. Escrow-only: `deliver_by` in future | store deal; eBL: compute TitleEscrow address (D-021) and request derived address from MPC (D-013); emit `deal_created` |
| 1a | `Created` (eBL, no derived address) | same | `refresh_derived_address` | anyone | address missing | re-issue the MPC view call |
| 2 | `Created` | `Created` (accepted) | `accept_deal` | supplier | not accepted; acceptance window open; eBL: derived address stored | emit `deal_accepted` |
| 3 | `Created` | `Cancelled` | `decline_deal` | supplier | — | emit `deal_cancelled` |
| 4 | `Created` | `Cancelled` | `withdraw_deal` | buyer | — | emit `deal_cancelled` |
| 5 | `Created` | `Cancelled` | `claim_timeout` | anyone | acceptance window passed | emit `deal_cancelled` |
| 6 | `Created` | `Funded` | `mt_on_transfer(msg={"deal_id":N})` | `config.verifier` | sender = buyer; accepted; one token = deal token; amount = deal amount; not funded | return `[0]`; emit `deal_funded`. Any mismatch: state unchanged, return full refund |
| 7 | `Funded` | `TitleHeld` | `confirm_title_held(evidence)` | §5a | eBL; before `ship_by` | `accept_by = now + window`; emit `title_held` |
| 8 | `TitleHeld` | `Settling` | `accept_documents` | buyer | before `accept_by` | start legs; emit `documents_accepted`, `settlement_started` |
| 9 | `TitleHeld` | `Refunding` | `refuse_documents(reason_hash)` | buyer | before `accept_by` | cash → buyer; title → supplier; emit `documents_refused`, `refund_started` |
| 10 | `TitleHeld` | `Settling` | `release` | anyone | at/after `accept_by` | start legs; emit `released_on_lapse`, `settlement_started` |
| 11 | `Funded` | `Settling` | `confirm_delivery` | buyer | escrow-only; before `deliver_by` | emit `delivered`, `settlement_started`; title `NotApplicable` |
| 12 | `Settling` | `Settled` | leg completion | — | cash `Done` ∧ title `Done`/`NotApplicable` | emit `deal_settled` |
| 13 | `Funded` / `TitleHeld` | `Disputed` | `dispute(reason_hash)` | buyer / supplier | never disputed before (D-006) | record `title_held`; emit `deal_disputed` |
| 14 | `Disputed` | `Settling` | `vote(Release)` reaching 2 | buyer / supplier / arbiter | eBL: title was held (cannot deliver title it doesn't control) | start legs |
| 15 | `Disputed` | `Refunding` | `vote(Refund)` reaching 2 | buyer / supplier / arbiter | — | cash → buyer; title → supplier if held, else `NotApplicable` |
| 16 | `Funded` | `Refunding` | `claim_timeout` | buyer | eBL; at/after `ship_by` (title never confirmed) | cash → buyer; title `NotApplicable` |
| 17 | `Funded` | `Refunding` | `claim_timeout` | buyer | escrow-only; at/after `deliver_by` | cash → buyer |
| 18 | `Refunding` | `Refunded` | leg completion | — | cash `Done` ∧ title `Done`/`NotApplicable` | emit `deal_refunded` |
| 19 | `Settling` / `Refunding` | same | `resume` | anyone | cash leg `Pending` | re-issue the cash transfer |
| 20 | `Settled` / `Refunded` | same | `confirm_title_at_deal_address(evidence)` | §5a | eBL; redelivery not in flight | redelivery `Some(Pending)`; emit `title_returned` |
| 21 | `Settled` / `Refunded` | same | `redeliver_title` | buyer (Settled) / supplier (Refunded) | redelivery `Pending` | mark requested; emit `redelivery_requested` |

`Disputed` has no timeout: two of three parties must vote. `claim_timeout`, `release`, `accept_documents`, `refuse_documents` and `confirm_delivery` are all rejected while `Disputed` (state check).

Errors: `InvalidState`, `Unauthorized`, `DeadlinePassed`, `DeadlineNotReached`, `InvalidTerms`, `TokenNotAllowed`, `AlreadyDisputed`, `ReleaseWithoutTitle`, `LegInFlight`, `FeeOutOfBounds`, `InsufficientDeposit`, `InsufficientGas`, `Paused`, `DealNotFound`, `DerivedAddressMissing`, `EvidenceMismatch`.

---

## 5a. Fact confirmations (D-019, D-021)

The contract cannot read Sepolia. A fact is accepted at once when confirmed by the party a false confirmation would hurt; otherwise when **both** other parties confirm the same fact. Each confirmer submits evidence `{ holder, beneficiary, block_number, tx_hash? }` as read on Sepolia. The contract requires holder **and** beneficiary to equal the address the fact expects (column 2) and rejects anything else (`EvidenceMismatch`); block numbers may differ between confirmers (D-021).

| Fact | Holder = beneficiary = | Alone | Or both of |
|---|---|---|---|
| title held (`Funded`) | deal-derived address | buyer | supplier + arbiter |
| title transferred (`Settling`) | `buyer_evm` | buyer | supplier + arbiter |
| title transferred (`Refunding`) | `supplier_evm` | supplier | buyer + arbiter |
| title transferred (redelivery after `Settled`) | `buyer_evm` | buyer | supplier + arbiter |
| title transferred (redelivery after `Refunded`) | `supplier_evm` | supplier | buyer + arbiter |
| title at deal address after `Settled` | deal-derived address | buyer | supplier + arbiter |
| title at deal address after `Refunded` | deal-derived address | supplier | buyer + arbiter |
| delivered (escrow-only) | — | buyer | — (dispute → 2-of-3 `Release`) |

Anyone can re-check every confirmation on Sepolia: `TitleEscrow.holder()` / `beneficiary()` at the stored block. The TitleEscrow address itself is computed by the contract from `(factory, implementation, registry, token_id)` (D-021), not supplied by a confirmer.

## 6. Votes

- Voters: buyer, supplier, arbiter. One vote each; may change before the threshold.
- Threshold: 2 identical decisions executes immediately in the same call.
- `Release` is rejected in eBL mode if the title was not held when the dispute opened.
- A deal can be disputed at most once (D-006).

---

## 7. Idempotency matrix (each has a test)

| Call repeated | Expected |
|---|---|
| `accept_deal` twice | second is a no-op |
| `mt_on_transfer` for an already-funded deal | full refund returned, state unchanged |
| confirmation of the same fact twice by the same party | second is a no-op |
| `accept_documents` / `release` after `Settling` started | rejected (`InvalidState`), state unchanged |
| `confirm_delivery` twice | second rejected (`InvalidState`), state unchanged |
| `resume` when cash leg `Done` or `TransferRequested` | no-op |
| `request_title_signature` while `SignatureRequested` | rejected `LegInFlight` (no duplicate MPC call) |
| `request_title_signature` after `Signed` | allowed (fee bump / new nonce) |
| title transferred confirmed twice | second is a no-op |
| `redeliver_title` twice | second is a no-op |
| `vote` same decision twice by the same voter | no-op |
| `claim_timeout` after `Refunding` started | rejected, state unchanged |

---

## 8. Events (NEP-297)

`standard: "tradelock"`, `version: "1.0.0"`. Events: `deal_created`, `deal_accepted`, `deal_cancelled`, `deal_funded`, `title_held`, `documents_accepted`, `documents_refused`, `released_on_lapse`, `delivered`, `settlement_started`, `refund_started`, `cash_leg_progress`, `title_leg_progress`, `confirmation`, `deal_disputed`, `vote_cast`, `deal_settled`, `deal_refunded`, `title_returned`, `redelivery_requested`. Each carries `deal_id` and state/leg info. Amounts and counterparties are public in this build (Standard rail, S-08).

---

## 9. Test matrix (minimum)

- Transitions 1–21 success paths.
- Every guard failure per transition (unauthorized caller, wrong state, deadline, mismatch).
- Idempotency matrix §7.
- D/P (D-020): accept before `accept_by`; refuse before `accept_by`; accept/refuse at or after `accept_by` rejected; `release` before `accept_by` rejected, after it allowed for anyone; dispute during the window blocks `release`.
- Votes: Release 2-of-3 (each pair), Refund 2-of-3 (each pair), vote change before threshold, Release rejected without title.
- Timeouts: `ship_by` (eBL, Funded), `deliver_by` (escrow-only), acceptance window; before/after each.
- Confirmations (§5a): each fact by the solo confirmer; by the two-party pair; wrong single party rejected; a lone non-protected confirmation does not transition.
- Leg failures: cash transfer failure then `resume`; MPC failure then re-request; fee bump; wrong-key signature rejected by `ecrecover`.
- Escrow-only mode full lifecycle, including T4 (supplier disputes before `deliver_by`).
- Redelivery after `Settled` and after `Refunded`; wrong caller rejected; repeated cycles; unconfirmed hand-over recovered after a `ship_by` refund.
- Sandbox E2E with the real Verifier WASM: settle and refund.
