//! V-16. Real nearcore sandbox + the near/intents Verifier built from source (`scripts/cashrail/build-verifier.sh`).
//! The upstream `multi-token-receiver-stub` stands in for `tradelock` as the `mt_on_transfer` receiver (test only).
//! Flow checked: init → buyer deposit (ft_transfer_call) → mt_transfer_call to receiver (accept + full refund)
//! → internal mt_transfer payout → ft_withdraw to the token contract.

use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract};
use serde_json::json;

const WASM_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../.external/wasm");
const AMOUNT: u128 = 1_000_000; // 1.000000 of a 6-decimal test stablecoin

fn wasm(name: &str) -> anyhow::Result<Vec<u8>> {
    std::fs::read(format!("{WASM_DIR}/{name}")).map_err(|e| anyhow::anyhow!("{WASM_DIR}/{name}: {e}; run scripts/cashrail/build-verifier.sh"))
}

async fn mt_balance(verifier: &Contract, account: &str, token_id: &str) -> anyhow::Result<u128> {
    let v: String = verifier.view("mt_balance_of").args_json(json!({"account_id": account, "token_id": token_id})).await?.json()?;
    Ok(v.parse()?)
}

async fn ft_balance(ft: &Contract, account: &Account) -> anyhow::Result<u128> {
    let v: String = ft.view("ft_balance_of").args_json(json!({"account_id": account.id()})).await?.json()?;
    Ok(v.parse()?)
}

macro_rules! ok {
    ($e:expr, $what:literal) => {{
        let r = $e.transact().await?;
        anyhow::ensure!(r.is_success(), "{} failed: {:?}", $what, r);
    }};
}

#[tokio::test]
async fn verifier_initializes_and_carries_cash_leg() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let buyer = root.create_subaccount("buyer").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let supplier = root.create_subaccount("supplier").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;

    // Test NEP-141 stablecoin (upstream releases/fungible-token.wasm), all supply to buyer.
    let ft = root.create_subaccount("usdc").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?
        .deploy(&wasm("fungible-token.wasm")?).await?.into_result()?;
    ok!(ft.call("new_default_meta").args_json(json!({"owner_id": buyer.id(), "total_supply": (AMOUNT * 100).to_string()})), "ft init");

    // Verifier from source. 1.3 MB → needs ~13 NEAR storage.
    let verifier = root.create_subaccount("intents").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?
        .deploy(&wasm("defuse.wasm")?).await?.into_result()?;
    ok!(verifier.call("new").args_json(json!({"config": {
        "wnear_id": "wrap.test.near",
        "fees": {"fee": 0, "fee_collector": verifier.id()},
        "roles": {"super_admins": [root.id()], "admins": {}, "grantees": {}}
    }})), "verifier init");

    let receiver = root.create_subaccount("tradelock").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?
        .deploy(&wasm("multi_token_receiver_stub.wasm")?).await?.into_result()?;

    for acct in [verifier.id(), supplier.id()] {
        ok!(root.call(ft.id(), "storage_deposit").args_json(json!({"account_id": acct})).deposit(NearToken::from_millinear(10)), "storage_deposit");
    }
    let token_id = format!("nep141:{}", ft.id());

    // 1. Buyer deposits into its own Verifier balance (msg = receiver account; empty = sender).
    ok!(buyer.call(ft.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": verifier.id(), "amount": AMOUNT.to_string(), "msg": ""}))
        .deposit(NearToken::from_yoctonear(1)).max_gas(), "deposit");
    assert_eq!(mt_balance(&verifier, buyer.id().as_str(), &token_id).await?, AMOUNT);

    // 2a. mt_transfer_call → receiver.mt_on_transfer returns full refund → buyer balance unchanged (mismatch path).
    ok!(buyer.call(verifier.id(), "mt_transfer_call")
        .args_json(json!({"receiver_id": receiver.id(), "token_id": token_id, "amount": AMOUNT.to_string(), "msg": "\"RefundAll\""}))
        .deposit(NearToken::from_yoctonear(1)).max_gas(), "mt_transfer_call refund");
    assert_eq!(mt_balance(&verifier, buyer.id().as_str(), &token_id).await?, AMOUNT);
    assert_eq!(mt_balance(&verifier, receiver.id().as_str(), &token_id).await?, 0);

    // 2b. mt_transfer_call accepted → funds held by the receiver (the Funded transition).
    ok!(buyer.call(verifier.id(), "mt_transfer_call")
        .args_json(json!({"receiver_id": receiver.id(), "token_id": token_id, "amount": AMOUNT.to_string(), "msg": "\"AcceptAll\""}))
        .deposit(NearToken::from_yoctonear(1)).max_gas(), "mt_transfer_call accept");
    assert_eq!(mt_balance(&verifier, receiver.id().as_str(), &token_id).await?, AMOUNT);
    assert_eq!(mt_balance(&verifier, buyer.id().as_str(), &token_id).await?, 0);

    // 3. Payout primitives tradelock will call: internal mt_transfer, then ft_withdraw by the recipient.
    //    (Executed from buyer→supplier here because the stub cannot initiate calls; same methods, same args.)
    ok!(buyer.call(ft.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": verifier.id(), "amount": AMOUNT.to_string(), "msg": ""}))
        .deposit(NearToken::from_yoctonear(1)).max_gas(), "second deposit");
    ok!(buyer.call(verifier.id(), "mt_transfer")
        .args_json(json!({"receiver_id": supplier.id(), "token_id": token_id, "amount": AMOUNT.to_string()}))
        .deposit(NearToken::from_yoctonear(1)), "mt_transfer payout");
    assert_eq!(mt_balance(&verifier, supplier.id().as_str(), &token_id).await?, AMOUNT);
    ok!(supplier.call(verifier.id(), "ft_withdraw")
        .args_json(json!({"token": ft.id(), "receiver_id": supplier.id(), "amount": AMOUNT.to_string()}))
        .deposit(NearToken::from_yoctonear(1)).max_gas(), "ft_withdraw");
    assert_eq!(mt_balance(&verifier, supplier.id().as_str(), &token_id).await?, 0);
    assert_eq!(ft_balance(&ft, &supplier).await?, AMOUNT);

    // 4. Without the 1 yocto, transfers are rejected (assert_one_yocto).
    let r = buyer.call(verifier.id(), "mt_transfer")
        .args_json(json!({"receiver_id": supplier.id(), "token_id": token_id, "amount": "1"})).transact().await?;
    assert!(r.is_failure());
    Ok(())
}

/// The exact init used for the testnet test stablecoin (docs/DEPLOYMENTS.md): 6 decimals, explicit
/// "no value" name. Checks `new` accepts this metadata and `ft_metadata` returns it.
#[tokio::test]
async fn test_stablecoin_init_matches_testnet_command() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let owner = root.create_subaccount("owner").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let ft = root.create_subaccount("tusd").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?
        .deploy(&wasm("fungible-token.wasm")?).await?.into_result()?;
    let r = ft.call("new").args_json(json!({
        "owner_id": owner.id(),
        "total_supply": "1000000000000",
        "metadata": {"spec": "ft-1.0.0", "name": "Tradelock Test Dollar (testnet, no value)", "symbol": "tUSD", "icon": null, "reference": null, "reference_hash": null, "decimals": 6}
    })).transact().await?;
    anyhow::ensure!(r.is_success(), "new failed: {:?}", r.failures());
    let meta: serde_json::Value = ft.view("ft_metadata").await?.json()?;
    assert_eq!(meta["decimals"], 6);
    assert_eq!(meta["symbol"], "tUSD");
    let bal: String = ft.view("ft_balance_of").args_json(json!({"account_id": owner.id()})).await?.json()?;
    assert_eq!(bal, "1000000000000");
    Ok(())
}
