# DEPLOYMENTS.md — Tradelock

Single record of every deployed contract, account, token id, and the transactions of the recorded demo run. The README links here. Fill values only from real deployments; leave `—` until then.

---

## NEAR (testnet, D-018 — no mainnet deployment)

| Item | Value | Explorer |
|---|---|---|
| Parent account | `samuelowen.testnet` | https://testnet.nearblocks.io/address/samuelowen.testnet |
| `tradelock` contract account (MPC predecessor) | `tradelock.samuelowen.testnet` — runs `tradelock` since 2026-11-05 (clean state; T1 proof removed, see Redeploy log) | https://testnet.nearblocks.io/address/tradelock.samuelowen.testnet |
| `tradelock` code hash | `GZpaZb3braUvDaDmjkgEuKHRLGXxWP6jB8u2a9NHxNns` (= sha256 `e747afe860f1d00ffd79140178b2e5a6409564fd5c0b2b6a2514730f46b47590` of `contracts/target/near/tradelock/tradelock.wasm`, 348,763 B) | deploy + `new`: https://testnet.nearblocks.io/txns/4HrKwhh6Wp8RegXcttw2FSYV3NmNiswA4kS7mZs1uoWJ |
| `tradelock` config | owner `samuelowen.testnet`; verifier `intents.samuelowen.testnet`; MPC `v1.signer-prod.testnet`; tokens `[nep141:tusd.samuelowen.testnet]`; registry `0x4e95…C811` → factory `0xfcafea…1D25` (impl `0x3781bd…62be`); doc window 60 s – 30 d; acceptance window 7 d | `get_config` |
| `tradelock-agent` contract | — | — |
| Approved agent code hash | — | — |
| Relayer account | — | — |
| MPC contract | `v1.signer-prod.testnet` (v3.18.0) | — |
| Cash rail (V-16) | `intents.samuelowen.testnet` — NEAR Intents Verifier `defuse` v0.4.5 (16d04f6) built from source; code hash `E6HyjJvB1yTvunu2QrWwgnBakBB1pm6unv386vQea9Ys` (= sha256 `c2830801fbf5abec534c76b41469782a7c11eb1f1ccec1bfe97ac54fdd28faf0`); init `wnear_id=wrap.testnet`, fee 0, super-admin `samuelowen.testnet` (single-operator trust, S-07) | create: https://testnet.nearblocks.io/txns/A6qXN3rHk5x3gGytnBe7SSUvfAUiF8RN5ZrkYr3mVzRT · deploy + `new`: https://testnet.nearblocks.io/txns/8kdQLo78z7gvw2xQVqhoGxQbJ533KQepbXfdexshSp6F |
| Test stablecoin (NEP-141) | `tusd.samuelowen.testnet` — "Tradelock Test Dollar (testnet, no value)", `tUSD`, 6 decimals, supply 1,000,000 tUSD to `samuelowen.testnet`; code hash `2GHRtd7FzQ4Jhp8Ltrr38TyvJHigQLL62MfDPt3dtaLj` (upstream near/intents `releases/fungible-token.wasm` @ 16d04f6) | create: https://testnet.nearblocks.io/txns/9dvpU64vXg8t8mtZxBwzrZQcm4Ndpqm8V5M1QVRAoQuu · deploy + `new`: https://testnet.nearblocks.io/txns/8JqV2mkA5YpHAP9yBJRvNsYfK4qzFsRskqw2ZV8oHNXr |
| Demo buyer | `buyer.samuelowen.testnet` (0.5 NEAR) | https://testnet.nearblocks.io/txns/DvEo8pEKikcrbthTKzjaianKKkdLFxv19fmQe7KzdVwB |
| Demo supplier | `supplier.samuelowen.testnet` (0.5 NEAR) | https://testnet.nearblocks.io/txns/6tpewLsCwme3v6vvKpX35DUW221GeU9nFBE8LuD26F15 |
| Demo arbiter | `arbiter.samuelowen.testnet` (0.5 NEAR) | https://testnet.nearblocks.io/txns/C12pu29o9nj2acRbWqo5ACCEH5QiuFZcBCGsBLwgXW4w |
| tUSD registrations (`storage_deposit`, 0.00125 NEAR) | intents https://testnet.nearblocks.io/txns/2KgZiGezTHETHdx1asjdMrzfyY3Hwt8SX2bq7DEBzdwF · buyer https://testnet.nearblocks.io/txns/BZAKvYXKtgGRqegiVysjmYJDkqEyKGA2Mksnt7Q47MN3 · supplier https://testnet.nearblocks.io/txns/GiSMEG36mtRrTnr9zoNhkBndRXkoN9UivTjtJGNko7Av · samuelowen (already registered, refunded) https://testnet.nearblocks.io/txns/75Xn3CpjJzDqEEZAECntdSYZJbiZ1xFR2sSTx6sq6zrh | |
| Mainnet | none. `samuelowen.near` is the prize-payout account only | — |

## Sepolia (chain id 11155111)

| Item | Value | Explorer |
|---|---|---|
| TradeTrust Title Escrow factory | `0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25` (official, D-014) | https://sepolia.etherscan.io/address/0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25 |
| TradeTrust token registry | `0x4e95A0b956d5CADeD0864Df2D26a508257BeC811` (ours, 5.5.2 artifact) | https://sepolia.etherscan.io/address/0x4e95A0b956d5CADeD0864Df2D26a508257BeC811 |
| Deployer ("carrier") address | `0x7Ffe010eF2F42A6d4E5C91bfd0f8f551b7aaB772` | https://sepolia.etherscan.io/address/0x7Ffe010eF2F42A6d4E5C91bfd0f8f551b7aaB772 |
| Gas funder address | `0x7Ffe010eF2F42A6d4E5C91bfd0f8f551b7aaB772` (same as carrier in T1; T13 linkage) | — |

## T1 — title-leg proof (testnet MPC → Sepolia)

Proof contract `contracts/tradelock-proof` ran on `tradelock.samuelowen.testnet` until 2026-11-05, when the account was deleted and recreated for the clean-state `tradelock` deploy (Redeploy log). Its transactions below remain on the explorers; its views (`get_derived_address`, `get_leg`) no longer exist. The derived address is unchanged after recreation (depends on account id + path): `pnpm t1:derive` printed `0x4C1fD766f54fD266509b4a578C88cE36fEd7a628` on 2026-11-05. Path `tradelock/proof/0`. Mainnet values from the earlier plan are void (D-018).

| Item | Value | Source / explorer |
|---|---|---|
| WASM sha256 (hex) | `c692e1ea081c3dbf081b3025d004293f1d6778468b6dd315461f8f1340f5f84a` | `cargo near build non-reproducible-wasm` (cargo-near 0.22.0, rustc 1.99.0), D-017 |
| WASM code hash (bs58) | `EN9dQoLaGsm9b8tmGfoP3KnHqrmuJ1WwkJzqvgBYaXsf` | must equal `code_hash` of `tradelock.samuelowen.testnet` after deploy |
| Derived EVM address | `0x4C1fD766f54fD266509b4a578C88cE36fEd7a628` | `v1.signer-prod.testnet.derived_public_key({path:"tradelock/proof/0", predecessor:"tradelock.samuelowen.testnet", domain_id:0})` == chainsig.js (2026-11-04) |
| Contract-stored derived address | `0x4C1fD766f54fD266509b4a578C88cE36fEd7a628` (matches JS + view, `pnpm t1:derive`) | `get_derived_address()` |
| Deploy + init tx | `CQ88EaozWBA1ifaK3PbSdMchmQbJ1iJqsDbjKEsPvDAW` | https://testnet.nearblocks.io/txns/CQ88EaozWBA1ifaK3PbSdMchmQbJ1iJqsDbjKEsPvDAW — on-chain code_hash `EN9dQoLaGsm9b8tmGfoP3KnHqrmuJ1WwkJzqvgBYaXsf` ✓ |
| `fetch_derived_address` tx | `5KBEvqvFwiWCPVLx1c4nDAqbeqBkBD7A2Ki89PhRE7Ud` | https://testnet.nearblocks.io/txns/5KBEvqvFwiWCPVLx1c4nDAqbeqBkBD7A2Ki89PhRE7Ud |
| `request_signature` tx | `HJyWxZri6st1SkKoJiJmFFM4qFQeHbfZG4uWu5KeGmWN` — log `signed nonce=0 r=0x603b1f65…2722 y_parity=1` (contract `ecrecover` == derived) | https://testnet.nearblocks.io/txns/HJyWxZri6st1SkKoJiJmFFM4qFQeHbfZG4uWu5KeGmWN |
| Sepolia carrier / funder | `0x7Ffe010eF2F42A6d4E5C91bfd0f8f551b7aaB772` (0.1 Sepolia ETH, 2026-11-04) | testnet key in `.env` |
| Sepolia supplier | `0xefbC93fC249040e533D8191Def10DC58D4108717` | testnet key in `.env` |
| Sepolia buyer (destination) | `0x6a7d2cF926879f23692ab6058258D1Eb7c3E46ed` | testnet key in `.env` |
| TradeTrust factory (official) | `0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25` | D-014 |
| Registry | `0x4e95A0b956d5CADeD0864Df2D26a508257BeC811` | https://sepolia.etherscan.io/address/0x4e95A0b956d5CADeD0864Df2D26a508257BeC811 |
| eBL token id | `99341760963449555253449397465407527918038632140097791491231289799516335410376` | synthetic (S-04) |
| TitleEscrow | `0x9E549E4467e013e71F87402CBDc5c6E438E7f193` (created by the official factory) | https://sepolia.etherscan.io/address/0x9E549E4467e013e71F87402CBDc5c6E438E7f193 |
| Registry deploy tx | `0x0598a8506851bae5e2aae6077a964d85ac9e6778301b4ee23473187800ad85b9` | https://sepolia.etherscan.io/tx/0x0598a8506851bae5e2aae6077a964d85ac9e6778301b4ee23473187800ad85b9 |
| Mint tx (holder = beneficiary = supplier) | `0x4be2fc58d490f8fd9e01616c6c3bbffd1c9afdf645d75e80e5663afbb63acc94` | https://sepolia.etherscan.io/tx/0x4be2fc58d490f8fd9e01616c6c3bbffd1c9afdf645d75e80e5663afbb63acc94 |
| Supplier gas top-up (0.005 ETH) | `0xa486bcfa206848b110de4c6f52979328fe3159c086b94e67ee80782e5c4059a7` | https://sepolia.etherscan.io/tx/0xa486bcfa206848b110de4c6f52979328fe3159c086b94e67ee80782e5c4059a7 |
| Hand-over tx (supplier → derived, `transferOwners`) | `0x8e5f9579061fa63c011d4fceb899c8f78f6d0cd3c316d6ace4c08d61f2037bba` (block 12062364; holder = beneficiary = derived) | https://sepolia.etherscan.io/tx/0x8e5f9579061fa63c011d4fceb899c8f78f6d0cd3c316d6ace4c08d61f2037bba |
| Derived-address gas top-up (worst case 0.000271192 + buffer 0.001 ETH) | `0xd8dbb83fd55bf5c6a9a94f8444afe3965cb165a26bca9bdfe7477650e83ea624` | https://sepolia.etherscan.io/tx/0xd8dbb83fd55bf5c6a9a94f8444afe3965cb165a26bca9bdfe7477650e83ea624 |
| **Title transfer tx (derived → buyer, MPC-signed)** | `0x0430ac7a831670fbd34cbea42b1759552977cbb1ad43ef7ab5ccf782fc84cd5d` (block 12062436, nonce 0, from `0x4C1f…7a628`); after: holder = beneficiary = `0x6a7d2cF926879f23692ab6058258D1Eb7c3E46ed` | https://sepolia.etherscan.io/tx/0x0430ac7a831670fbd34cbea42b1759552977cbb1ad43ef7ab5ccf782fc84cd5d |

## Shade Agent

| Item | Value |
|---|---|
| TEE provider | Phala Cloud |
| Docker image digest | — |
| Registered agent account(s) | — |
| Registration tx | — |

---

## Demo run — Settled deal (reference run, 2026-11-06)

`pnpm demo settle --yes` on `tradelock.samuelowen.testnet` + Sepolia. Record: `docs/demo-runs/settle-deal-0.json`. Deal page: `/deals/0` (read-only, checked headless in light/dark/mobile). The video is recorded on a separate deal.

| Step | NEAR tx | Sepolia tx | Notes |
|---|---|---|---|
| Deal id | | | `0` (eBL, 1.000000 tUSD, payout Internal → `supplier.samuelowen.testnet`) |
| Deal-derived EVM address | | [`0xdDa5844e9C176a551DF9A6FE10cd184d3FedcA4c`](https://sepolia.etherscan.io/address/0xdDa5844e9C176a551DF9A6FE10cd184d3FedcA4c) | path `tradelock/deal/0`; equals the address precomputed from the testnet MPC key before the contract existed (V-03 vectors) |
| eBL token id | | | `104295279139002128102322045713388317457442561070163837919685403088255535251263` (synthetic, S-04) |
| TitleEscrow | | [`0x15149d3f55801f7A112A595520De234d8821DA76`](https://sepolia.etherscan.io/address/0x15149d3f55801f7A112A595520De234d8821DA76) | equals the contract-computed escrow (D-021) |
| `create_deal` | [`75fS9VX…`](https://testnet.nearblocks.io/txns/75fS9VX8Txjjo18WiWZoxgi9GY5RMBUMfJfGEbZ5Shum) | | buyer; derived address stored by MPC callback |
| `accept_deal` | [`S85eXTZ…`](https://testnet.nearblocks.io/txns/S85eXTZtwyGc2givLLrhDCtHeQn56NXRA561dgpsNYd) | | supplier |
| tUSD top-up to buyer | [`6o6j1pk…`](https://testnet.nearblocks.io/txns/6o6j1pkWkpAJLX9QLCPu9bjANTBpJbie3KstdTVQEuTH) | | test token, no value |
| Buyer deposit into Verifier (`ft_transfer_call`) | [`7B38KvV…`](https://testnet.nearblocks.io/txns/7B38KvV1Ay52knzFHBWwkZAJGyUvutkxSpgkNqepozvZ) | | |
| Funding (`mt_transfer_call` → `mt_on_transfer`) | [`Ct1G92B…`](https://testnet.nearblocks.io/txns/Ct1G92BNNxF4mSea23go6UFrDaMqbdEQqLNVorj7koKo) | | → `Funded` |
| Mint eBL to supplier | | [`0x7c8c4444…`](https://sepolia.etherscan.io/tx/0x7c8c444444267ebf31e85e93d4d7dace95de2303f3f701500f0f14ef770d2f0e) | carrier (S-01) |
| Supplier transfers eBL to deal address | | [`0x10c05548…`](https://sepolia.etherscan.io/tx/0x10c055480a95a05dc8e78b5b916ac82faa310279cc23f282ba4b7519b6a0c1d1) | `transferOwners(deal, deal)` |
| `confirm_title_held` | [`9q66Ye7…`](https://testnet.nearblocks.io/txns/9q66Ye75XXLPabLNLnV3FRBzcsWC98E73T8vJCdxjStk) | | buyer; evidence Sepolia block 12079528 → `TitleHeld` |
| `accept_documents` (D-020) | [`5FxqswA…`](https://testnet.nearblocks.io/txns/5FxqswApG284GyQusQUGxC1gxwrUez2b5XV7apBBDWo4) | | → `Settling`; cash payout to supplier in the same flow (cash leg `Done`) |
| Deal address gas top-up | | [`0x31b26c22…`](https://sepolia.etherscan.io/tx/0x31b26c2264b53587ffd606bfd5f24c7d05a00fc790bd93cdd535d1564fbe5e41) | funder = carrier (T13) |
| MPC signature request | [`DZFWBvA…`](https://testnet.nearblocks.io/txns/DZFWBvA2zQAfdZUZXKGMjPSdbQGAUMfGR67nVUcBi9LR) | | `v1.signer-prod.testnet`; `ecrecover` == deal address |
| Title transfer to buyer (MPC-signed) | | [`0x5ad29edf…`](https://sepolia.etherscan.io/tx/0x5ad29edf7e351452e394a8cba8e3f67f03f3fe445650ff0fda8ef9804f58fb09) | from `0xdDa5…cA4c`, nonce 0 |
| `report_broadcast` | [`H48wonR…`](https://testnet.nearblocks.io/txns/H48wonRqtYVxiiraj9QZqLUnyFCt3NYpMBNKeUG4hteg) | | informational |
| `confirm_title_transferred` / `Settled` | [`H4xqmpS…`](https://testnet.nearblocks.io/txns/H4xqmpShrUq63r9dkp1DfF2ip6ENE7woUzohRhiCFQau) | | buyer; evidence block 12079534 → `Settled` |
| End state (checked 2026-11-06) | | | TitleEscrow holder = beneficiary = buyer `0x6a7d…46ed`, prevHolder = deal address; Verifier tUSD: supplier 1000000, buyer 0, tradelock 0 |

## Demo run — Refunded deal (reference run, 2026-11-06)

`pnpm demo refund --yes`. Record: `docs/demo-runs/refund-deal-1.json`. Deal page: `/deals/1`.

| Step | NEAR tx | Sepolia tx | Notes |
|---|---|---|---|
| Deal id | | | `1` (eBL, 1.000000 tUSD) |
| Deal-derived EVM address | | [`0xB7B78680Ee1514F200DFD70175337f54e1e79F2C`](https://sepolia.etherscan.io/address/0xB7B78680Ee1514F200DFD70175337f54e1e79F2C) | path `tradelock/deal/1`; matches the precomputed V-03 vector |
| eBL token id | | | `67598645745586729567900395984556573429350673355073740874999096870346300437509` (synthetic) |
| TitleEscrow | | [`0x5a97ED6d6d43A8D1a45BA6680EA2A596dc7AfaF6`](https://sepolia.etherscan.io/address/0x5a97ED6d6d43A8D1a45BA6680EA2A596dc7AfaF6) | |
| `create_deal` | [`EQnq1Nj…`](https://testnet.nearblocks.io/txns/EQnq1NjthbUU1pHNnTqN9zQsK6kudHV1Z6JgLb484n83) | | |
| `accept_deal` | [`GpxoY3Z…`](https://testnet.nearblocks.io/txns/GpxoY3ZqCejF2z4a2eBCKwf8FXvFMDXzQwiDeJfXUu2j) | | |
| tUSD top-up / Verifier deposit | [`DBpv8K8…`](https://testnet.nearblocks.io/txns/DBpv8K8DJqhgZQuZLzEpHxiQcrqexTDvLeZ2JEqCPkVh) · [`8uU4buG…`](https://testnet.nearblocks.io/txns/8uU4buGJbyn5ZV8gDW2zVZkRKZvQ3zbzP948312yZ6dK) | | |
| Funding | [`8KCfynQ…`](https://testnet.nearblocks.io/txns/8KCfynQzG4XR3AwpDe8LzDbEihu6LKS7kZYcit1Ab88z) | | → `Funded` |
| Mint / hand-over to deal address | | [`0x598f9128…`](https://sepolia.etherscan.io/tx/0x598f9128a2012679999a19ccf16ae3f532ceaf46ae1aa6e6418b859d89b92537) · [`0x71ba9baa…`](https://sepolia.etherscan.io/tx/0x71ba9baa447d13bb8aed857eca5489a334db9eacbf44007ced932b1330bcbe5e) | |
| `confirm_title_held` | [`EwScn5y…`](https://testnet.nearblocks.io/txns/EwScn5yhfHK6V567pbdZj76NMxo2c5EXAz2qR4mtpPMV) | | buyer, block 12079630 → `TitleHeld` |
| Trigger: `refuse_documents` (D-020) | [`4w36bUB…`](https://testnet.nearblocks.io/txns/4w36bUB9r3aHCGbcoQtjduF9kFb9CLhEaUUr5yxCVGAN) | | → `Refunding` |
| Cash refund to buyer | (same flow, cash leg `Done`) | | Verifier `mt_transfer` back to buyer |
| Deal address gas top-up | | [`0xee192a4c…`](https://sepolia.etherscan.io/tx/0xee192a4c76a116170760612e642913c2e54d64be53d87cff3773c23ab05e175f) | |
| MPC signature request | [`61yL8sY…`](https://testnet.nearblocks.io/txns/61yL8sYqfipbqbt5KHjSNAQS4gLs8pX4WRqer9QEuS6D) | | `transferOwners(supplier, supplier)` |
| Title returned to supplier (MPC-signed) | | [`0x870a0ace…`](https://sepolia.etherscan.io/tx/0x870a0ace8e1885a14624cab022a3f317efeec9a67e92e2693917875cc8631b01) | from `0xB7B7…9F2C`, nonce 0 |
| `report_broadcast` | [`8KT2xWV…`](https://testnet.nearblocks.io/txns/8KT2xWVwqGEaWxDA1nsPy6EHk6kcDfk34GUjDmzXT4QV) | | |
| `confirm_title_transferred` / `Refunded` | [`GhvTdyB…`](https://testnet.nearblocks.io/txns/GhvTdyBgTrANuZMwcy4SQHEQbHEZV2Ki1AbEE7RPrakc) | | supplier, block 12079636 → `Refunded` |
| End state (checked 2026-11-06) | | | holder = beneficiary = supplier `0xefbC…8717`, prevHolder = deal address; Verifier tUSD: buyer 1000000, supplier 1000000 (from deal 0), tradelock 0 |

## Demo run — Escrow-only deal (reference run, 2026-11-07)

`pnpm demo escrow --yes`. Record: `docs/demo-runs/escrow-deal-2.json`. Deal page: `/deals/2`. No title leg, no Sepolia transactions.

| Step | NEAR tx | Notes |
|---|---|---|
| Deal id | | `2` (escrow-only, 1.000000 tUSD, payout `Withdraw` → `supplier.samuelowen.testnet`) |
| `create_deal` | [`7uQXkyH…`](https://testnet.nearblocks.io/txns/7uQXkyHceNRMKosguhtdTdaDd2RcnrPWo2q5Hhbi1YDj) | `assertFtRegistered([supplier])` passed first |
| `accept_deal` | [`8kZ1w22…`](https://testnet.nearblocks.io/txns/8kZ1w22DLnmTZDxqQbyy4c1DxFL7boBBHYMuhp7JQ6Lc) | |
| Funding (`mt_transfer_call`) | [`7M8qiFF…`](https://testnet.nearblocks.io/txns/7M8qiFFmLyn7RuonNUUDWZzkx7B46SUxeRGfdMb37coc) | buyer's Verifier balance (refunded in deal 1) |
| `confirm_delivery` → `ft_withdraw` payout → `Settled` | [`q9u62g7…`](https://testnet.nearblocks.io/txns/q9u62g7y2A4ea5bicD2mmxTfmtT9kfJxdJaC6xWrFsi) | Verifier `ft_withdraw` returned the full amount; cash leg `Done` |
| End state (checked 2026-11-07) | | supplier `ft_balance_of` = 1000000 (outside the Verifier); Verifier tUSD: buyer 0, supplier 1000000 (deal 0), tradelock 0; Verifier's own tUSD = 1000000 (backs supplier's internal balance) |

## Demo run — Disputed deal, settled 2-of-3 (reference run, 2026-11-07)

`pnpm demo dispute --yes`. Record: `docs/demo-runs/dispute-deal-3.json`. Deal page: `/deals/3`. Scenario: after `TitleHeld` the buyer disputes ("documents don't match order", hash `a12fd5fb…5980` only); votes buyer Refund, supplier Release, arbiter Release → 2-of-3 Release; the buyer does not confirm receipt, so supplier + arbiter confirm (D-019 two-party path).

| Step | NEAR tx | Sepolia tx | Notes |
|---|---|---|---|
| Deal id / deal address | | [`0xf4acb96D97D92b1eF42Ec02F3D4Ed2f4FfA09ee1`](https://sepolia.etherscan.io/address/0xf4acb96D97D92b1eF42Ec02F3D4Ed2f4FfA09ee1) | `3`; address precomputed before the run |
| TitleEscrow | | [`0x30cf1781729f03e90eA90EC63D276f8D230A3a50`](https://sepolia.etherscan.io/address/0x30cf1781729f03e90eA90EC63D276f8D230A3a50) | eBL token `29070066098367625448759700635252040184152480278591853303108457477680352471206` |
| `create_deal` · `accept_deal` | [`2YpMDah…`](https://testnet.nearblocks.io/txns/2YpMDahrZhGGd1V9rb2fY7Pv9wFsSv7xyZM1tKHBavHS) · [`BzQ4RmG…`](https://testnet.nearblocks.io/txns/BzQ4RmGA2VL1bm3atiecRK6NM9QGVM3PXasRFrz9Mpds) | | |
| top-up · Verifier deposit · funding | [`7Z51zRM…`](https://testnet.nearblocks.io/txns/7Z51zRMu5Qqf9tNbgZfQG6KJhvEdUroWnM54s5GMC7D9) · [`64DBhYL…`](https://testnet.nearblocks.io/txns/64DBhYLzXawEYNwCshACmgBcDXdexn4nceVhNeJtGCPx) · [`iG8RnGo…`](https://testnet.nearblocks.io/txns/iG8RnGo8DK2viG8LwRwTsNrZaSpk1msnPX3obnSTwbU) | | → `Funded` |
| Mint · hand-over | | [`0x897a2bb7…`](https://sepolia.etherscan.io/tx/0x897a2bb76eba95b9e4ec2f526bcd14dcc6d715be882d914cfa1dd57c661de96f) · [`0x3512f3cc…`](https://sepolia.etherscan.io/tx/0x3512f3cc884ec1195d0ee4a32cdfed8bbc1963dadb3203036e22f3d31f78973e) | |
| `confirm_title_held` | [`nHekFfB…`](https://testnet.nearblocks.io/txns/nHekFfB2UPpW1LyZRDPFpoGrn5gYW7w3YkanpsykX8A) | | buyer, block 12079988 → `TitleHeld` |
| `dispute` (buyer) | [`26u9Ec1…`](https://testnet.nearblocks.io/txns/26u9Ec1C5myXKLAhyuishpDwXBobMVhb82ZagfAkkQcQ) | | → `Disputed` |
| `vote` buyer Refund · supplier Release · arbiter Release | [`E4t2vFY…`](https://testnet.nearblocks.io/txns/E4t2vFYyucMA4iUNTGGzZb1gQ6bZphm6yXcryMmRQoas) · [`CXQTjEZ…`](https://testnet.nearblocks.io/txns/CXQTjEZwhVg3wmyDZSC2v4BgAVHfGkaVDXDArqHwZFYt) · [`Gsk6o7K…`](https://testnet.nearblocks.io/txns/Gsk6o7KCVR1WbKa5CEhtVHggMPFgU6pxYBK95zKR6uvc) | | third vote reaches 2-of-3 Release → `Settling`; cash payout to supplier |
| Deal address gas top-up | | [`0x6365b3ed…`](https://sepolia.etherscan.io/tx/0x6365b3edf2c840669f1d644e59f5537fe44d43c1d231e8091055f040b4479f70) | |
| MPC signature request | [`7P2nH2s…`](https://testnet.nearblocks.io/txns/7P2nH2smZP3Pz7Az2ghBwWaLtqfD3kha8nGys1Yacp26) | | |
| Title transfer to buyer (MPC-signed) | | [`0x412a2039…`](https://sepolia.etherscan.io/tx/0x412a20399ace6763ff4007dadc5baddf548b81796fcea0e418a1efcf97f99b3d) | from `0xf4ac…9ee1`, nonce 0 |
| `report_broadcast` | [`2Be8ni5…`](https://testnet.nearblocks.io/txns/2Be8ni5zipt2rpV7fkFQs5rx7i8tXVyqeU8mBM7ttcnW) | | |
| `confirm_title_transferred` supplier → arbiter | [`AGYKzy8…`](https://testnet.nearblocks.io/txns/AGYKzy8Uhi8mHDhdcZUvKeWegrTxQsjysq2BnwQYHkpw) · [`CUtzCC7…`](https://testnet.nearblocks.io/txns/CUtzCC7ywFWbocWMrCWbC13PE4YbUMHQYqfYniipCggG) | | supplier's recorded (`accepted: false`), arbiter's completes the two-party rule → `Settled` |
| End state (checked 2026-11-07) | | | holder = beneficiary = buyer, prevHolder = deal address; votes Refund/Release/Release; Verifier tUSD: supplier 2000000, buyer 0, tradelock 0 |

## Demo run — Settled deal for the video (2026-11-14)

`pnpm demo prep --yes`, then `pnpm demo settle --step` one step at a time, with a screenshot of `/deals/4` taken after each step for the video. Record: `docs/demo-runs/settle-deal-4.json` (holds the last step only). Sepolia hashes for mint and hand-over were read from the TitleEscrow's logs.

| Step | NEAR tx | Sepolia tx | Notes |
|---|---|---|---|
| Deal id / deal address | | [`0xdEFA693B1Ef2Db6517F3181e305Ce67F42ec96eB`](https://sepolia.etherscan.io/address/0xdEFA693B1Ef2Db6517F3181e305Ce67F42ec96eB) | `4` (eBL, 1.000000 tUSD, payout Internal → supplier); path `tradelock/deal/4` |
| TitleEscrow | | [`0xEDc8a5F1C4f5D03c6e98BcC14EBbC9D032677162`](https://sepolia.etherscan.io/address/0xEDc8a5F1C4f5D03c6e98BcC14EBbC9D032677162) | eBL token `90674131651972596680356225214560272379818136913102089950851978333539127899653` (synthetic) |
| `create_deal` | [`BbuRatY…`](https://testnet.nearblocks.io/txns/BbuRatyXBEvUVbVGNFnULCGWTvMkRoSFoVJNwerVFo6w) | | buyer |
| `accept_deal` | [`CiszXL5…`](https://testnet.nearblocks.io/txns/CiszXL5VFveo6YLxYbQzxtV6ob39CifLdi8XQZvjKdGy) | | supplier |
| Funding (`mt_transfer_call`) | [`HMnS3tg…`](https://testnet.nearblocks.io/txns/HMnS3tgGpEcPUzaEazeiNwazHpSX5hvBzd5FmG5Qucmh) | | → `Funded` |
| Mint · hand-over to deal address | | [`0xa3812640…`](https://sepolia.etherscan.io/tx/0xa38126402216d0fc05457c32de739363af77ff92a5819c9277ab49a527e50cdb) · [`0x3699b65b…`](https://sepolia.etherscan.io/tx/0x3699b65bbdb4ed3474821ed37b9b0a6ccac7825e063dff9f641838c908f0950e) | carrier mint; supplier `transferOwners(deal, deal)` |
| `confirm_title_held` | [`4Fv4dYY…`](https://testnet.nearblocks.io/txns/4Fv4dYYZocBAQehDcqXPp77xMXJQghBGf2rYcKyoBHRk) | | buyer → `TitleHeld` |
| `accept_documents` | [`FUpQ8zv…`](https://testnet.nearblocks.io/txns/FUpQ8zvLoskMtWjTXqcK6QZsojbUDwmSDFc7Lng1BAwf) | | → `Settling`; cash leg `Done` |
| MPC signature request | [`GbYq7WG…`](https://testnet.nearblocks.io/txns/GbYq7WGgiRsFCQ5H8eF4tMaUmGYLgLeP74abhgY2cpgM) | | after carrier gas top-up of the deal address |
| Title transfer to buyer (MPC-signed) | | [`0x43178ee2…`](https://sepolia.etherscan.io/tx/0x43178ee2a2fbb05d5d78e8820850657bebeabd6011ba4ed67a08c0b5d8ecf796) | from `0xdEFA…96eB`, nonce 0 |
| `report_broadcast` | [`79wsTPM…`](https://testnet.nearblocks.io/txns/79wsTPMVEXnEnPrmNY7NvPmUnLB1Rr87A9i5uimqCMJv) | | |
| `confirm_title_transferred` / `Settled` | [`bFg3Y2M…`](https://testnet.nearblocks.io/txns/bFg3Y2MYacxfe3CteWbsTRAbnkGhyGdptjLKCMWLyUd) | | buyer → `Settled` |
| End state (checked 2026-11-14) | | | holder = beneficiary = buyer `0x6a7d…46ed` |

## Redeploy log

| Date | Component | Reason | Old → New |
|---|---|---|---|
| 2026-11-05 | `tradelock.samuelowen.testnet` | Clean state for `tradelock` (proof state would block `new`) | deleted (https://testnet.nearblocks.io/txns/5uTvSKGyoz1VCnYqcWZUgvu58gpncMMpNo9jQ3pwScH6, balance → `samuelowen.testnet`), recreated with 5 NEAR (https://testnet.nearblocks.io/txns/CANkcjpCPrJbh5ho6J56qwmKYaTLA7a5TqhaxctVL6nx); proof code `EN9dQo…` → `tradelock` code `GZpaZb3…` |
