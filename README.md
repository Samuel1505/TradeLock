# Tradelock

**The buyer only gets the goods when the seller gets paid — and no bank is needed.**

Tradelock is documents-against-payment for cross-border trade without a bank. One NEAR contract holds both sides of a deal: the buyer's stablecoins in its NEAR Intents balance, and the supplier's electronic bill of lading (a TradeTrust eBL, legal title to the cargo) at an EVM address only that contract controls through NEAR Chain Signatures. When the buyer accepts the documents, the contract pays the supplier and has the NEAR MPC network sign the title over to the buyer.

Runs on **NEAR testnet + Sepolia** (no mainnet deployment). Built at NEAR HACKATHON. Track: Real-World Money.

---

## The problem

- Cross-border trade has a first-mover problem: suppliers won't ship before payment; buyers won't pay before they own the goods.
- Banks solve it with documents against payment: they hold the bill of lading until the buyer pays. It is slow and costly, and about 41% of small businesses' trade finance applications are rejected (Asian Development Bank), within a ~$2.5T global trade finance gap.
- Without a bank, small traders prepay and hope, or send final, public stablecoin payments.

## What Tradelock does

1. The buyer proposes terms; the supplier accepts; the buyer funds the deal from its NEAR Intents balance.
2. The supplier hands the eBL to the deal's own Sepolia address (derived by NEAR MPC for this contract and deal).
3. The buyer checks the title on Sepolia and confirms it is held.
4. The buyer **accepts the documents** → the contract pays the supplier and signs the title over to the buyer, who collects the cargo with it. Or the buyer **refuses** within the window → cash back to the buyer, title back to the supplier. Silence past the window → anyone can release.
5. Disputes are decided 2-of-3 by buyer, supplier and arbiter. Deals without an eBL run as stablecoin escrow, released when the buyer confirms delivery.

---

## Try it

Prerequisites: Node 24 + pnpm 11, Rust with the `wasm32-unknown-unknown` target, `cargo-near` 0.22.0, Foundry (`anvil`, `cast`), git.

### Tier A — verify everything without keys (checked from a clean clone, 2026-11-07)

1. `pnpm install` → workspace installs.
2. `pnpm typecheck` → `shared`, `evm`, `scripts`, `web` typecheck clean.
3. `pnpm test` → web 12, scripts 8, evm 5 (TradeTrust 5.5.2 bytecode on anvil), shared 4 (+4 live-network tests skipped unless `RUN_NETWORK_TESTS=1`).
4. `pnpm contracts:build` → builds the NEAR Intents Verifier from source (`near/intents` @ `defuse/v0.4.5`), `tradelock`, the T1 proof contract and the test-only MockSigner, and prints their sha256. With the same toolchain, `tradelock.wasm` = `e747afe8…` and `defuse.wasm` = `c2830801…`, the code deployed on testnet (another rustc version may give different bytes).
5. `pnpm contracts:test` → 116 Rust tests: `tradelock` 82 unit + 3 sandbox E2E, T1 proof 24 + 1 sandbox, `tradelock-evm` 4, Verifier check 2. Sandbox tests run the real nearcore runtime and the real Verifier code.
6. `cp web/.env.example web/.env.local && pnpm --filter @tradelock/web build && pnpm --filter @tradelock/web start` → app on http://localhost:3000, reading the deployed testnet contracts.
7. In a second terminal: `pnpm --filter @tradelock/web exec playwright install chromium && pnpm --filter @tradelock/web e2e:deployed` → 104 checks pass: `/deals/0`, `/deals/1`, `/deals/2` and `/demo` render the on-chain end state with live Sepolia title reads, no wallet needed.
8. Check title on Sepolia yourself (see [Verify title yourself](#verify-title-yourself)).

### Tier B — run your own deal

Needs your own NEAR testnet accounts (keys in the `near` CLI keychain) and Sepolia testnet keys in `.env` (copy `.env.example`).

```
pnpm demo settle            # dry run: prints the exact next command and stops
pnpm demo settle --yes      # eBL: create → accept → fund → mint eBL → hand over → confirm held → accept documents → MPC-signed title transfer → Settled
pnpm demo refund --yes      # eBL: … → refuse documents → cash back + title back to the supplier → Refunded
pnpm demo escrow --yes      # escrow-only: … → confirm delivery → ft_withdraw payout to the supplier → Settled
pnpm demo settle --deal 5 --step   # one step at a time; resumes any deal from its on-chain state
```

The runner reads the deal and its TitleEscrow before every step, prints the exact command, and sends only with `--yes` (or one step with `--step`). It checks token registration (`storage_balance_of`) before any `ft_withdraw` payout.

---

## Deployed (NEAR testnet + Sepolia)

| What | Where |
|---|---|
| `tradelock` contract | [`tradelock.samuelowen.testnet`](https://testnet.nearblocks.io/address/tradelock.samuelowen.testnet) (code hash `GZpaZb3braUvDaDmjkgEuKHRLGXxWP6jB8u2a9NHxNns`) |
| NEAR Intents Verifier (our instance, S-07) | [`intents.samuelowen.testnet`](https://testnet.nearblocks.io/address/intents.samuelowen.testnet) (`defuse` v0.4.5, code hash `E6HyjJvB1yTvunu2QrWwgnBakBB1pm6unv386vQea9Ys`) |
| Test stablecoin (no value) | [`tusd.samuelowen.testnet`](https://testnet.nearblocks.io/address/tusd.samuelowen.testnet), `tUSD`, 6 decimals |
| MPC | `v1.signer-prod.testnet` |
| TradeTrust registry (ours) / TitleEscrow factory (TradeTrust's official) | [`0x4e95…C811`](https://sepolia.etherscan.io/address/0x4e95A0b956d5CADeD0864Df2D26a508257BeC811) / [`0xfcaf…1D25`](https://sepolia.etherscan.io/address/0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25) |

Completed deals (all steps and transactions: [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md)):

| Deal | Path | Key transactions | Title on Sepolia now |
|---|---|---|---|
| 0 | documents accepted → **Settled** | [accept documents](https://testnet.nearblocks.io/txns/5FxqswApG284GyQusQUGxC1gxwrUez2b5XV7apBBDWo4) · [MPC signature](https://testnet.nearblocks.io/txns/DZFWBvA2zQAfdZUZXKGMjPSdbQGAUMfGR67nVUcBi9LR) · [title transfer](https://sepolia.etherscan.io/tx/0x5ad29edf7e351452e394a8cba8e3f67f03f3fe445650ff0fda8ef9804f58fb09) | [TitleEscrow `0x1514…DA76`](https://sepolia.etherscan.io/address/0x15149d3f55801f7A112A595520De234d8821DA76): holder = beneficiary = buyer |
| 1 | documents refused → **Refunded** | [refuse documents](https://testnet.nearblocks.io/txns/4w36bUB9r3aHCGbcoQtjduF9kFb9CLhEaUUr5yxCVGAN) · [MPC signature](https://testnet.nearblocks.io/txns/61yL8sYqfipbqbt5KHjSNAQS4gLs8pX4WRqer9QEuS6D) · [title back](https://sepolia.etherscan.io/tx/0x870a0ace8e1885a14624cab022a3f317efeec9a67e92e2693917875cc8631b01) | [TitleEscrow `0x5a97…AfaF6`](https://sepolia.etherscan.io/address/0x5a97ED6d6d43A8D1a45BA6680EA2A596dc7AfaF6): holder = beneficiary = supplier |
| 2 | escrow-only → **Settled** | [confirm delivery + `ft_withdraw` payout](https://testnet.nearblocks.io/txns/q9u62g7y2A4ea5bicD2mmxTfmtT9kfJxdJaC6xWrFsi) | — (no bill of lading) |

### Title-leg proof (T1)

The first test of the project: a NEAR contract moved title to goods on Sepolia.

1. Our registry minted an eBL; TradeTrust's factory created its TitleEscrow ([mint](https://sepolia.etherscan.io/tx/0x4be2fc58d490f8fd9e01616c6c3bbffd1c9afdf645d75e80e5663afbb63acc94)).
2. The supplier handed holder + beneficiary to `0x4C1f…7a628`, the address `v1.signer-prod.testnet` derives for `tradelock.samuelowen.testnet` + `tradelock/proof/0` ([hand-over](https://sepolia.etherscan.io/tx/0x8e5f9579061fa63c011d4fceb899c8f78f6d0cd3c316d6ace4c08d61f2037bba)).
3. The contract built `transferOwners(buyer, buyer, 0x)` itself and requested the MPC signature; its callback checked with `ecrecover` that the signer is the derived address ([NEAR tx](https://testnet.nearblocks.io/txns/HJyWxZri6st1SkKoJiJmFFM4qFQeHbfZG4uWu5KeGmWN)).
4. Sepolia accepted the signed transaction ([title transfer](https://sepolia.etherscan.io/tx/0x0430ac7a831670fbd34cbea42b1759552977cbb1ad43ef7ab5ccf782fc84cd5d)).

### Verify title yourself

Title lives on Sepolia, not in our contract. For any deal, read the TitleEscrow:

```
cast call 0x15149d3f55801f7A112A595520De234d8821DA76 "holder()(address)"      --rpc-url https://ethereum-sepolia-rpc.publicnode.com
cast call 0x15149d3f55801f7A112A595520De234d8821DA76 "beneficiary()(address)" --rpc-url https://ethereum-sepolia-rpc.publicnode.com
cast call 0x4e95A0b956d5CADeD0864Df2D26a508257BeC811 "ownerOf(uint256)(address)" <tokenId> --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

Deal 0's escrow returns the buyer `0x6a7d2cF926879f23692ab6058258D1Eb7c3E46ed` for both; its `prevHolder()` is the deal address. Every party confirmation on NEAR stores the Sepolia block it was read at, so anyone can re-check it.

---

## How it uses NEAR

| Primitive | Exact job in Tradelock |
|---|---|
| Chain Signatures (`v1.signer-prod.testnet`) | Each deal gets its own MPC-derived Sepolia address, stored by the contract from `derived_public_key`. The contract builds the EIP-1559 `transferOwners` transaction itself (callers set only nonce and bounded fees), requests the signature, and accepts it only if `ecrecover` gives the deal address |
| NEAR Intents Verifier | Holds the buyer's stablecoin as the contract's balance: funding via `mt_transfer_call` → `mt_on_transfer` (mismatches refunded), payout via `mt_transfer` or `ft_withdraw`, refund via `mt_transfer`. On testnet: our own instance built from `near/intents` source (S-07) |
| 2-of-3 approvals, SputnikDAO-style (implemented natively in `tradelock`, not a SputnikDAO instance) | Buyer, supplier and arbiter vote Release or Refund in a dispute; two matching votes execute |
| Confidential Intents | **Not used.** Mainnet-only; design kept in `docs/NEAR_INTEGRATION.md` §3 (S-08) |
| Shade Agents | **Not used (cut).** Title facts are confirmed by the parties instead, re-checkable on Sepolia (S-10) |
| NEAR AI Cloud | **Not used (cut).** No free credits (S-09) |
| Meta transactions | **Not built.** Users pay their own testnet gas |

Track hints used — Real-World Money: Stablecoins, NEAR Intents.

**Why only on NEAR:** a contract on one chain holds legal title to goods on another chain through MPC, and releases it against payment held in the same deal.

## Architecture

```
        CASH LEG (NEAR testnet)                           TITLE LEG (Sepolia)
  Buyer ──tUSD──► Verifier (own instance) ──┐     ┌──► TradeTrust TitleEscrow ◄── Supplier's eBL
                                            ▼     ▼
                        ┌──────────────────────────────────┐
                        │      tradelock deal contract      │◄── parties confirm title facts
                        └──────────────────────────────────┘     (re-checkable on Sepolia)
                                 │                │
       Supplier ◄──tUSD──────────┘                └──MPC-signed transfer──► Buyer owns the goods
```

Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## State machine

eBL: `Created → Funded → TitleHeld → (accept documents | window lapses → release) → Settling → Settled`; refuse documents → `Refunding → Refunded`. Escrow-only: `Funded → (buyer confirms delivery) → Settling → Settled`. Plus `Disputed` (2-of-3) and `Cancelled`. Each leg is tracked separately and every step is idempotent and resumable. Full spec: [`docs/STATE_MACHINE.md`](docs/STATE_MACHINE.md).

## Privacy: what is and isn't private

- **Private:** document contents (only hashes on-chain); cargo details.
- **Public in this build:** cash-leg amounts and counterparties (Confidential Intents is not used).
- **Public by design:** that a deal exists, its state changes and votes; that a title transfer happened on Sepolia (fresh address per deal).
- **Known leaks:** one gas funder tops up all deal addresses on Sepolia, linking them; timing correlation between NEAR and Sepolia.

Threat model: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Known limitations and substitutions

- Settlement is orchestrated across two chains, **not atomic**. The contract holds both assets before either moves.
- **No protection against non-conforming goods.** As in bank D/P, payment is released against documents, not inspection.
- **Title facts are confirmed by the parties**, not an oracle: the party a false confirmation would hurt may confirm alone, otherwise the other two together; all re-checkable on Sepolia.
- **Testnet only**, with our own Verifier instance (we hold its admin role) and a test stablecoin with no value; we act as the carrier that issues the eBL; documents are synthetic. Full list: [`docs/SUBSTITUTIONS.md`](docs/SUBSTITUTIONS.md).
- eBL adoption is early (~13% of bills of lading in 2025; ~11 MLETR jurisdictions). Escrow-only mode serves most trade today.
- **Open legal question:** whether an address controlled by a 2-of-3 contract via MPC satisfies MLETR "exclusive control." Not claimed.
- No fiat ramps, KYC, licensing, or production key management.

## Tests

- `pnpm contracts:test` (after `pnpm contracts:build`): every transition and guard in `docs/STATE_MACHINE.md`, idempotency, document windows, votes (each pair, both directions), party confirmations, cash failure + resume, title signing with `ecrecover` (wrong key and high-s rejected), redelivery, in-contract tx bytes == viem reference vectors, TitleEscrow address == the real Sepolia escrow; sandbox E2E with the real Verifier for settle, refuse, release-on-lapse, escrow-only `ft_withdraw`, mismatched funding, MPC failure then retry.
- `pnpm test`: TradeTrust flow on anvil incl. `rejectTransferOwners`; MPC derivation == chainsig.js == `v1.signer` vectors; demo step logic; web role actions, copy, timelines.
- `RUN_NETWORK_TESTS=1 pnpm --filter @tradelock/shared test`: live testnet derivation, and every deal's stored address == chainsig.js.
- `pnpm --filter @tradelock/web e2e:deployed`: headless, no wallet, against the deployed contracts.

## Roadmap

- Inspection certificates as an optional release condition.
- Fully confidential title leg; Confidential Intents on mainnet.
- Receivables financing on funded, title-backed deals.
- NEAR Business treasury integration.

Design decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md).
