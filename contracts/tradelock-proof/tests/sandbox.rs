//! Loads the cargo-near-built WASM into a real nearcore sandbox: proves the runtime accepts the binary,
//! init validates config, and the in-contract payload equals the viem vector under the real host keccak.
//! Requires `cargo near build non-reproducible-wasm` first (the test fails with a clear message otherwise).

use near_workspaces::types::NearToken;
use serde_json::json;

const WASM: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../target/near/tradelock_proof/tradelock_proof.wasm");
const TX_VECTORS: &str = include_str!("vectors/title_tx.json");

#[tokio::test]
async fn sandbox_deploy_init_and_payload_matches_vector() -> anyhow::Result<()> {
    let wasm = std::fs::read(WASM).map_err(|e| anyhow::anyhow!("{WASM}: {e}; run `cargo near build non-reproducible-wasm`"))?;
    let worker = near_workspaces::sandbox().await?;
    let contract = worker.dev_deploy(&wasm).await?;

    let v: serde_json::Value = serde_json::from_str(TX_VECTORS)?;
    let t = &v["vectors"][0];
    let init = contract
        .call("new")
        .args_json(json!({
            "owner": contract.id(),
            "config": {
                "mpc_contract": "v1.signer.test.near",
                "path": "tradelock/proof/0",
                "chain_id": t["chain_id"],
                "title_escrow": t["to"],
                "destination": t["destination"],
                "mpc_sign_deposit": "1",
                "mpc_sign_gas_tgas": 15,
                "callback_gas_tgas": 10,
                "max_fee_per_gas": "200000000000",
                "max_priority_fee_per_gas": "20000000000",
                "max_gas_limit": "500000"
            }
        }))
        .transact()
        .await?;
    assert!(init.is_success(), "init failed: {init:?}");

    let view: serde_json::Value = contract
        .view("preview_tx")
        .args_json(json!({
            "nonce": t["nonce"], "max_fee_per_gas": t["max_fee_per_gas"],
            "max_priority_fee_per_gas": t["max_priority_fee_per_gas"], "gas_limit": t["gas_limit"]
        }))
        .await?
        .json()?;
    assert_eq!(view["unsigned_tx"], t["unsigned_tx"]);
    assert_eq!(view["payload"], t["payload"]);

    // Request before derived address is fetched must fail cleanly on-chain.
    let r = contract
        .call("request_signature")
        .args_json(json!({"nonce": "0", "max_fee_per_gas": "30000000000", "max_priority_fee_per_gas": "1", "gas_limit": "120000"}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(r.is_failure());
    assert!(format!("{r:?}").contains("derived address not fetched"));
    Ok(())
}
