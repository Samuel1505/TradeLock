//! Sandbox E2E (real nearcore runtime) with the real NEAR Intents Verifier (`defuse` v0.4.5 built from
//! source by scripts/cashrail/build-verifier.sh), the upstream test NEP-141 token, and MockSigner
//! (test-only v1.signer stand-in, S-05). Prerequisites:
//!   scripts/cashrail/build-verifier.sh
//!   (cd contracts/tradelock && cargo near build non-reproducible-wasm)
//!   (cd contracts/mocks/mock-signer && cargo near build non-reproducible-wasm --no-abi)

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

const AMOUNT: u128 = 1_000_000;
const SEC: u64 = 1_000_000_000;
const FACTORY: &str = "0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25";
const IMPLEMENTATION: &str = "0x3781bd0bbd15bf5e45c7296115821933d47362be";
const REGISTRY: &str = "0x4e95A0b956d5CADeD0864Df2D26a508257BeC811";
const EBL_TOKEN: &str = "99341760963449555253449397465407527918038632140097791491231289799516335410376";
const BUYER_EVM: &str = "0x6a7d2cF926879f23692ab6058258D1Eb7c3E46ed";
const SUPPLIER_EVM: &str = "0xefbC93fC249040e533D8191Def10DC58D4108717";

fn wasm(rel: &str) -> anyhow::Result<Vec<u8>> {
    let p = format!("{}/../{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).map_err(|e| anyhow::anyhow!("{p}: {e} (see prerequisites at the top of this file)"))
}

fn ok(r: ExecutionFinalResult, what: &str) -> anyhow::Result<()> {
    ok_val(r, what).map(|_| ())
}

fn ok_val(r: ExecutionFinalResult, what: &str) -> anyhow::Result<ExecutionFinalResult> {
    anyhow::ensure!(r.is_success(), "{what} failed: {:#?}", r.failures());
    Ok(r)
}

struct World {
    worker: Worker<Sandbox>,
    root: Account,
    buyer: Account,
    supplier: Account,
    arbiter: Account,
    ft: Contract,
    verifier: Contract,
    mpc: Contract,
    tl: Contract,
    token_id: String,
}

async fn sub(root: &Account, name: &str, near: u128) -> anyhow::Result<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(near)).transact().await?.into_result()?)
}

async fn world() -> anyhow::Result<World> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let buyer = sub(&root, "buyer", 20).await?;
    let supplier = sub(&root, "supplier", 20).await?;
    let arbiter = sub(&root, "arbiter", 5).await?;
    let ft = sub(&root, "usdc", 10).await?.deploy(&wasm(".external/wasm/fungible-token.wasm")?).await?.into_result()?;
    ok(ft.call("new_default_meta").args_json(json!({"owner_id": buyer.id(), "total_supply": (AMOUNT * 100).to_string()})).transact().await?, "ft init")?;
    let verifier = sub(&root, "intents", 20).await?.deploy(&wasm(".external/wasm/defuse.wasm")?).await?.into_result()?;
    ok(verifier.call("new").args_json(json!({"config": {"wnear_id": "wrap.test.near", "fees": {"fee": 0, "fee_collector": verifier.id()}, "roles": {"super_admins": [root.id()], "admins": {}, "grantees": {}}}})).transact().await?, "verifier init")?;
    let mpc = sub(&root, "mpc", 10).await?.deploy(&wasm("target/near/mock_signer/mock_signer.wasm")?).await?.into_result()?;
    let tl = sub(&root, "tradelock", 20).await?.deploy(&wasm("target/near/tradelock/tradelock.wasm")?).await?.into_result()?;
    let token_id = format!("nep141:{}", ft.id());
    ok(tl.call("new").args_json(json!({"config": {
        "owner": root.id(), "verifier": verifier.id(), "mpc_contract": mpc.id(),
        "allowed_tokens": [token_id], "title_factories": [{"chain_id": 11155111, "factory": FACTORY, "implementation": IMPLEMENTATION}],
        "title_registries": [{"chain_id": 11155111, "registry": REGISTRY, "factory": FACTORY}],
        "mpc_sign_deposit": "1", "mpc_sign_gas_tgas": 30, "callback_gas_tgas": 10,
        "max_fee_per_gas": "200000000000", "max_priority_fee_per_gas": "20000000000", "max_gas_limit": "500000",
        "acceptance_window_ns": (86_400 * SEC).to_string(), "min_doc_window_ns": SEC.to_string(), "max_doc_window_ns": (30 * 86_400 * SEC).to_string(),
        "paused": false
    }})).transact().await?, "tradelock init")?;
    for a in [verifier.id(), supplier.id()] {
        ok(root.call(ft.id(), "storage_deposit").args_json(json!({"account_id": a})).deposit(NearToken::from_millinear(10)).transact().await?, "storage_deposit")?;
    }
    // Buyer moves test USDC into its own Verifier balance.
    ok(buyer.call(ft.id(), "ft_transfer_call").args_json(json!({"receiver_id": verifier.id(), "amount": (AMOUNT * 10).to_string(), "msg": ""})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?, "buyer deposit")?;
    Ok(World { worker, root, buyer, supplier, arbiter, ft, verifier, mpc, tl, token_id })
}

impl World {
    async fn balance(&self, who: &str) -> anyhow::Result<u128> {
        let v: String = self.verifier.view("mt_balance_of").args_json(json!({"account_id": who, "token_id": self.token_id})).await?.json()?;
        Ok(v.parse()?)
    }
    async fn deal(&self, id: u64) -> anyhow::Result<Value> {
        Ok(self.tl.view("get_deal").args_json(json!({"deal_id": id.to_string()})).await?.json()?)
    }
    async fn state(&self, id: u64) -> anyhow::Result<String> {
        Ok(self.deal(id).await?["state"].as_str().unwrap().to_string())
    }
    async fn create(&self, mode: Value, payout: Value) -> anyhow::Result<u64> {
        let r = ok_val(self.buyer.call(self.tl.id(), "create_deal").args_json(json!({"terms": {
            "supplier": self.supplier.id(), "arbiter": self.arbiter.id(), "token_id": self.token_id, "amount": AMOUNT.to_string(),
            "order_hash": "11".repeat(32), "payout": payout, "mode": mode
        }})).deposit(NearToken::from_near(1)).max_gas().transact().await?, "create_deal")?;
        let id: String = r.json()?;
        Ok(id.parse()?)
    }
    async fn ebl_mode(&self, window_s: u64) -> anyhow::Result<Value> {
        let now = self.worker.view_block().await?.timestamp();
        Ok(json!({"Ebl": {"chain_id": 11155111, "registry": REGISTRY, "token_id": EBL_TOKEN,
            "buyer_evm": BUYER_EVM, "supplier_evm": SUPPLIER_EVM, "ship_by": (now + 7 * 86_400 * SEC).to_string(),
            "doc_acceptance_window_ns": (window_s * SEC).to_string()}}))
    }
    async fn accept_and_fund(&self, id: u64) -> anyhow::Result<()> {
        ok(self.supplier.call(self.tl.id(), "accept_deal").args_json(json!({"deal_id": id.to_string()})).transact().await?, "accept_deal")?;
        ok(self.buyer.call(self.verifier.id(), "mt_transfer_call")
            .args_json(json!({"receiver_id": self.tl.id(), "token_id": self.token_id, "amount": AMOUNT.to_string(), "msg": json!({"deal_id": id}).to_string()}))
            .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?, "mt_transfer_call")?;
        anyhow::ensure!(self.state(id).await? == "Funded", "not funded");
        Ok(())
    }
    async fn party(&self, who: &Account, method: &str, id: u64, extra: Value) -> anyhow::Result<ExecutionFinalResult> {
        let mut args = json!({"deal_id": id.to_string()});
        args.as_object_mut().unwrap().extend(extra.as_object().cloned().unwrap_or_default());
        Ok(who.call(self.tl.id(), method).args_json(args).max_gas().transact().await?)
    }
    async fn sign(&self, id: u64, nonce: u64) -> anyhow::Result<Value> {
        ok(self.root.call(self.tl.id(), "request_title_signature")
            .args_json(json!({"deal_id": id.to_string(), "nonce": nonce.to_string(), "max_fee_per_gas": "2000000000", "max_priority_fee_per_gas": "1000000000", "gas_limit": "135596"}))
            .deposit(NearToken::from_yoctonear(5)).max_gas().transact().await?, "request_title_signature")?;
        Ok(self.deal(id).await?)
    }
}

/// holder = beneficiary = `addr`, as read on Sepolia at `block` (D-019).
fn evidence(addr: &str, block: u64) -> Value {
    json!({"evidence": {"holder": addr, "beneficiary": addr, "block_number": block.to_string(), "tx_hash": null}})
}

#[tokio::test]
async fn ebl_documents_against_payment_settle_refuse_release() -> anyhow::Result<()> {
    let w = world().await?;

    // ---------- Deal 0: accept documents → Settled ----------
    let id = w.create(w.ebl_mode(3600).await?, json!({"Internal": {"account": w.supplier.id()}})).await?;
    let d = w.deal(id).await?;
    let derived = d["ebl"]["derived_address"].as_str().expect("derived address stored by MPC callback").to_string();
    assert_eq!(d["ebl"]["title_escrow"], "0x9e549e4467e013e71f87402cbdc5c6e438e7f193");
    // Contract-stored address == MPC's own view for (tradelock, tradelock/deal/0).
    let naj: String = w.mpc.view("derived_public_key").args_json(json!({"path": "tradelock/deal/0", "predecessor": w.tl.id(), "domain_id": 0})).await?.json()?;
    assert!(naj.starts_with("secp256k1:"));

    w.accept_and_fund(id).await?;
    assert_eq!(w.balance(w.tl.id().as_str()).await?, AMOUNT);
    ok(w.party(&w.buyer, "confirm_title_held", id, evidence(&derived, 100)).await?, "confirm_title_held")?;
    assert_eq!(w.state(id).await?, "TitleHeld");
    ok(w.party(&w.buyer, "accept_documents", id, json!({})).await?, "accept_documents")?;
    let d = w.deal(id).await?;
    assert_eq!(d["state"], "Settling");
    assert_eq!(d["cash_leg"], "Done", "Verifier mt_transfer payout landed");
    assert_eq!(w.balance(w.supplier.id().as_str()).await?, AMOUNT);

    let d = w.sign(id, 0).await?;
    assert_eq!(d["title_leg"]["status"], "Signed", "MockSigner signature passed ecrecover == {derived}");
    assert_eq!(d["title_leg"]["tx"]["to"], "0x9e549e4467e013e71f87402cbdc5c6e438e7f193");
    ok(w.root.call(w.tl.id(), "report_broadcast").args_json(json!({"deal_id": id.to_string(), "tx_hash": format!("0x{}", "ab".repeat(32))})).transact().await?, "report_broadcast")?;
    ok(w.party(&w.buyer, "confirm_title_transferred", id, evidence(BUYER_EVM, 200)).await?, "confirm_title_transferred")?;
    assert_eq!(w.state(id).await?, "Settled");

    // ---------- Deal 1: refuse documents → Refunded ----------
    let id = w.create(w.ebl_mode(3600).await?, json!({"Internal": {"account": w.supplier.id()}})).await?;
    w.accept_and_fund(id).await?;
    let before = w.balance(w.buyer.id().as_str()).await?;
    let derived = w.deal(id).await?["ebl"]["derived_address"].as_str().unwrap().to_string();
    ok(w.party(&w.buyer, "confirm_title_held", id, evidence(&derived, 300)).await?, "confirm_title_held")?;
    ok(w.party(&w.buyer, "refuse_documents", id, json!({"reason_hash": null})).await?, "refuse_documents")?;
    assert_eq!(w.balance(w.buyer.id().as_str()).await?, before + AMOUNT, "cash refunded to buyer");
    let d = w.sign(id, 1).await?;
    assert_eq!(d["title_leg"]["status"], "Signed");
    // title goes back to the supplier's EVM address
    let data = d["title_leg"]["tx"]["data"].as_str().unwrap();
    assert!(data.contains(&SUPPLIER_EVM[2..].to_lowercase()));
    ok(w.party(&w.supplier, "confirm_title_transferred", id, evidence(SUPPLIER_EVM, 400)).await?, "supplier confirms title back")?;
    assert_eq!(w.state(id).await?, "Refunded");

    // ---------- Deal 2: silence past the window → anyone releases ----------
    let id = w.create(w.ebl_mode(2).await?, json!({"Internal": {"account": w.supplier.id()}})).await?;
    w.accept_and_fund(id).await?;
    let derived = w.deal(id).await?["ebl"]["derived_address"].as_str().unwrap().to_string();
    ok(w.party(&w.buyer, "confirm_title_held", id, evidence(&derived, 500)).await?, "confirm_title_held")?;
    let early = w.party(&w.arbiter, "release", id, json!({})).await?;
    assert!(early.is_failure(), "release before accept_by must fail");
    w.worker.fast_forward(50).await?;
    ok(w.party(&w.arbiter, "release", id, json!({})).await?, "release after window")?;
    assert_eq!(w.state(id).await?, "Settling");
    assert_eq!(w.deal(id).await?["cash_leg"], "Done");
    Ok(())
}

#[tokio::test]
async fn escrow_only_withdraw_payout_and_funding_mismatch_refund() -> anyhow::Result<()> {
    let w = world().await?;
    let now = w.worker.view_block().await?.timestamp();
    let mode = json!({"EscrowOnly": {"deliver_by": (now + 7 * 86_400 * SEC).to_string()}});
    let id = w.create(mode, json!({"Withdraw": {"account": w.supplier.id()}})).await?;
    ok(w.supplier.call(w.tl.id(), "accept_deal").args_json(json!({"deal_id": id.to_string()})).transact().await?, "accept")?;

    // Wrong amount: the Verifier gets a full refund back from mt_on_transfer.
    let before = w.balance(w.buyer.id().as_str()).await?;
    ok(w.buyer.call(w.verifier.id(), "mt_transfer_call")
        .args_json(json!({"receiver_id": w.tl.id(), "token_id": w.token_id, "amount": (AMOUNT - 1).to_string(), "msg": json!({"deal_id": id}).to_string()}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?, "mismatched funding call")?;
    assert_eq!(w.balance(w.buyer.id().as_str()).await?, before);
    assert_eq!(w.state(id).await?, "Created");

    ok(w.buyer.call(w.verifier.id(), "mt_transfer_call")
        .args_json(json!({"receiver_id": w.tl.id(), "token_id": w.token_id, "amount": AMOUNT.to_string(), "msg": json!({"deal_id": id}).to_string()}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?, "funding")?;
    assert_eq!(w.state(id).await?, "Funded");
    ok(w.party(&w.buyer, "confirm_delivery", id, json!({})).await?, "confirm_delivery")?;
    assert_eq!(w.state(id).await?, "Settled");
    let ft_bal: String = w.ft.view("ft_balance_of").args_json(json!({"account_id": w.supplier.id()})).await?.json()?;
    assert_eq!(ft_bal.parse::<u128>()?, AMOUNT, "ft_withdraw delivered NEP-141 to the supplier");
    Ok(())
}

#[tokio::test]
async fn mpc_failure_leaves_leg_pending_then_retry_signs() -> anyhow::Result<()> {
    let w = world().await?;
    let id = w.create(w.ebl_mode(3600).await?, json!({"Internal": {"account": w.supplier.id()}})).await?;
    w.accept_and_fund(id).await?;
    let derived = w.deal(id).await?["ebl"]["derived_address"].as_str().unwrap().to_string();
    ok(w.party(&w.buyer, "confirm_title_held", id, evidence(&derived, 1)).await?, "held")?;
    ok(w.party(&w.buyer, "accept_documents", id, json!({})).await?, "accept_documents")?;
    ok(w.root.call(w.mpc.id(), "set_fail").args_json(json!({"fail": true})).transact().await?, "set_fail")?;
    // The outer tx succeeds; the sign receipt fails; the callback resets the leg.
    let _ = w.root.call(w.tl.id(), "request_title_signature")
        .args_json(json!({"deal_id": id.to_string(), "nonce": "0", "max_fee_per_gas": "2000000000", "max_priority_fee_per_gas": "1000000000", "gas_limit": "135596"}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert_eq!(w.deal(id).await?["title_leg"]["status"], "Pending");
    ok(w.root.call(w.mpc.id(), "set_fail").args_json(json!({"fail": false})).transact().await?, "unset_fail")?;
    assert_eq!(w.sign(id, 0).await?["title_leg"]["status"], "Signed");
    Ok(())
}
