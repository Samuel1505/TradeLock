//! T1 title-leg proof (CLAUDE.md §6, NEAR_INTEGRATION §1.3).
//!
//! The contract — not the caller — builds the EIP-1559 tx that moves a TradeTrust TitleEscrow from this
//! account's MPC-derived EVM address to a stored destination (D-002). The caller supplies only nonce and
//! bounded fee fields. The payload is signed by `v1.signer` for the stored derivation path; the callback
//! accepts the signature only if `ecrecover` yields the stored derived address.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::{env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};
use tradelock_evm::tx::Eip1559Fields;
use tradelock_evm::{address, parse_address, to_hex, tradetrust, Address};

/// secp256k1 signing domain on v1.signer (DECISIONS V-01).
pub const MPC_SECP256K1_DOMAIN_ID: u32 = 0;
/// Lowest gas limit accepted from the executor (plain transfer cost).
pub const MIN_GAS_LIMIT: u64 = 21_000;
/// Gas reserved for this contract's own work around the cross-contract calls.
const OWN_OVERHEAD: Gas = Gas::from_tgas(15);
const DERIVED_KEY_VIEW_GAS: Gas = Gas::from_tgas(10);

/// Owner-updatable parameters. MPC deposit and gas floor are config, never literals (D-012).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub mpc_contract: AccountId,
    pub path: String,
    pub chain_id: u64,
    /// TitleEscrow being moved (0x…).
    pub title_escrow: String,
    /// Holder and beneficiary after the transfer (0x…).
    pub destination: String,
    /// Exact deposit forwarded to `sign` (yoctoNEAR). 1 on v1.signer 3.17.0.
    pub mpc_sign_deposit: U128,
    /// Gas attached to the `sign` receipt. v1.signer 3.17.0 requires ≥ 15 Tgas.
    pub mpc_sign_gas_tgas: u64,
    pub callback_gas_tgas: u64,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
    pub max_gas_limit: U64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct StoredTx {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub gas_limit: u64,
    pub to: Address,
    pub data: Vec<u8>,
    pub payload: [u8; 32],
}

impl StoredTx {
    fn fields(&self) -> Eip1559Fields {
        Eip1559Fields {
            chain_id: self.chain_id,
            nonce: self.nonce,
            max_priority_fee_per_gas: self.max_priority_fee_per_gas,
            max_fee_per_gas: self.max_fee_per_gas,
            gas_limit: self.gas_limit,
            to: self.to,
            value: 0,
            data: self.data.clone(),
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct EvmSignature {
    pub r: [u8; 32],
    pub s: [u8; 32],
    pub y_parity: u8,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum Leg {
    Idle,
    SignatureRequested { tx: StoredTx },
    Signed { tx: StoredTx, sig: EvmSignature },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TitleProof {
    owner: AccountId,
    config: Config,
    title_escrow: Address,
    destination: Address,
    derived_address: Option<Address>,
    leg: Leg,
}

// ---------- JSON views ----------

#[near(serializers = [json])]
pub struct TxView {
    pub chain_id: u64,
    pub nonce: U64,
    pub max_priority_fee_per_gas: U128,
    pub max_fee_per_gas: U128,
    pub gas_limit: U64,
    pub to: String,
    pub value: U128,
    pub data: String,
    /// 0x02 ‖ rlp(fields)
    pub unsigned_tx: String,
    /// keccak256(unsigned_tx) — what the MPC signs
    pub payload: String,
}

#[near(serializers = [json])]
pub struct SignatureView {
    pub r: String,
    pub s: String,
    pub y_parity: u8,
}

#[near(serializers = [json])]
#[serde(tag = "status")]
pub enum LegView {
    Idle,
    SignatureRequested { tx: TxView },
    Signed { tx: TxView, signature: SignatureView },
}

/// Response of `v1.signer.sign` (DECISIONS V-01).
#[near(serializers = [json])]
struct MpcSignature {
    scheme: String,
    big_r: MpcAffinePoint,
    s: MpcScalar,
    recovery_id: u8,
}
#[near(serializers = [json])]
struct MpcAffinePoint {
    affine_point: String,
}
#[near(serializers = [json])]
struct MpcScalar {
    scalar: String,
}

fn keccak(data: &[u8]) -> [u8; 32] {
    env::keccak256_array(data)
}

fn tx_view(tx: &StoredTx) -> TxView {
    TxView {
        chain_id: tx.chain_id,
        nonce: U64(tx.nonce),
        max_priority_fee_per_gas: U128(tx.max_priority_fee_per_gas),
        max_fee_per_gas: U128(tx.max_fee_per_gas),
        gas_limit: U64(tx.gas_limit),
        to: to_hex(&tx.to),
        value: U128(0),
        data: to_hex(&tx.data),
        unsigned_tx: to_hex(&tx.fields().unsigned_bytes()),
        payload: to_hex(&tx.payload),
    }
}

fn parse_addr_or_panic(label: &str, s: &str) -> Address {
    let a = parse_address(s).unwrap_or_else(|e| env::panic_str(&format!("{label}: {e}")));
    require!(a != [0u8; 20], format!("{label}: zero address"));
    a
}

/// Validate and decode the MPC response. Returns Err with a reason instead of panicking, so the
/// callback can always move the leg out of `SignatureRequested`.
fn parse_mpc_signature(bytes: &[u8]) -> Result<EvmSignature, String> {
    let sig: MpcSignature = serde_json::from_slice(bytes).map_err(|e| format!("bad MPC response JSON: {e}"))?;
    if sig.scheme != "Secp256k1" {
        return Err(format!("unexpected scheme {}", sig.scheme));
    }
    let big_r = hex::decode(&sig.big_r.affine_point).map_err(|e| format!("big_r hex: {e}"))?;
    if big_r.len() != 33 || !(big_r[0] == 2 || big_r[0] == 3) {
        return Err("big_r must be a 33-byte compressed point".into());
    }
    let s: [u8; 32] = hex::decode(&sig.s.scalar)
        .map_err(|e| format!("s hex: {e}"))?
        .try_into()
        .map_err(|_| "s must be 32 bytes".to_string())?;
    if sig.recovery_id > 1 {
        return Err(format!("recovery_id {} out of range", sig.recovery_id));
    }
    let mut r = [0u8; 32];
    r.copy_from_slice(&big_r[1..]);
    Ok(EvmSignature { r, s, y_parity: sig.recovery_id })
}

/// Signer address of (payload, sig) via the ecrecover host function. `malleability_flag = true`
/// rejects high-s signatures, which Ethereum would also reject (EIP-2).
fn recover_address(payload: &[u8; 32], sig: &EvmSignature) -> Option<Address> {
    let mut rs = [0u8; 64];
    rs[..32].copy_from_slice(&sig.r);
    rs[32..].copy_from_slice(&sig.s);
    let pk = env::ecrecover(payload, &rs, sig.y_parity, true)?;
    let h = keccak(&pk);
    let mut a = [0u8; 20];
    a.copy_from_slice(&h[12..]);
    Some(a)
}

#[near]
impl TitleProof {
    #[init]
    pub fn new(owner: AccountId, config: Config) -> Self {
        let title_escrow = parse_addr_or_panic("title_escrow", &config.title_escrow);
        let destination = parse_addr_or_panic("destination", &config.destination);
        require!(title_escrow != destination, "title_escrow and destination must differ");
        require!(!config.path.is_empty(), "path must not be empty");
        require!(config.mpc_sign_gas_tgas > 0 && config.callback_gas_tgas > 0, "gas config must be > 0");
        require!(config.max_priority_fee_per_gas.0 <= config.max_fee_per_gas.0, "priority fee bound above max fee bound");
        require!(config.max_gas_limit.0 >= MIN_GAS_LIMIT, "max_gas_limit below 21000");
        Self { owner, config, title_escrow, destination, derived_address: None, leg: Leg::Idle }
    }

    // ---------- derived address (D-013) ----------

    /// Ask v1.signer for this account's derived key on `config.path` and store the EVM address.
    /// Anyone may call; idempotent.
    pub fn fetch_derived_address(&mut self) -> Promise {
        let args = json!({
            "path": self.config.path,
            "predecessor": env::current_account_id(),
            "domain_id": MPC_SECP256K1_DOMAIN_ID,
        });
        Promise::new(self.config.mpc_contract.clone())
            .function_call("derived_public_key", args.to_string().into_bytes(), NearToken::from_yoctonear(0), DERIVED_KEY_VIEW_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(self.config.callback_gas_tgas)).on_derived_public_key())
    }

    #[private]
    pub fn on_derived_public_key(&mut self, #[callback_result] key: Result<String, PromiseError>) -> String {
        let key = key.unwrap_or_else(|_| env::panic_str("derived_public_key call failed"));
        let addr = address::evm_address_from_naj(&key, keccak).unwrap_or_else(|e| env::panic_str(&e));
        if let Some(existing) = self.derived_address {
            // The MPC root key must never change; refuse to overwrite silently.
            require!(existing == addr, format!("derived address changed: stored {} vs {}", to_hex(&existing), to_hex(&addr)));
        }
        self.derived_address = Some(addr);
        log!("derived_address {} for {}/{}", to_hex(&addr), env::current_account_id(), self.config.path);
        to_hex(&addr)
    }

    // ---------- signing ----------

    /// Build the transfer tx in-contract and request an MPC signature. Owner-only in the proof.
    /// Allowed from `Idle` or `Signed` (fee bump / retry); rejected while a request is in flight.
    #[payable]
    pub fn request_signature(&mut self, nonce: U64, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, gas_limit: U64) -> Promise {
        require!(env::predecessor_account_id() == self.owner, "Unauthorized");
        require!(self.derived_address.is_some(), "derived address not fetched; call fetch_derived_address first");
        require!(!matches!(self.leg, Leg::SignatureRequested { .. }), "LegInFlight");

        let c = &self.config;
        require!(max_priority_fee_per_gas.0 <= max_fee_per_gas.0, "FeeOutOfBounds: priority fee > max fee");
        require!(max_fee_per_gas.0 > 0 && max_fee_per_gas.0 <= c.max_fee_per_gas.0, "FeeOutOfBounds: max_fee_per_gas");
        require!(max_priority_fee_per_gas.0 <= c.max_priority_fee_per_gas.0, "FeeOutOfBounds: max_priority_fee_per_gas");
        require!(gas_limit.0 >= MIN_GAS_LIMIT && gas_limit.0 <= c.max_gas_limit.0, "FeeOutOfBounds: gas_limit");

        let deposit = c.mpc_sign_deposit.0;
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= deposit, format!("InsufficientDeposit: attach at least {deposit} yoctoNEAR"));
        let sign_gas = Gas::from_tgas(c.mpc_sign_gas_tgas);
        let cb_gas = Gas::from_tgas(c.callback_gas_tgas);
        let needed = sign_gas.saturating_add(cb_gas).saturating_add(OWN_OVERHEAD);
        require!(env::prepaid_gas() >= needed, format!("InsufficientGas: attach at least {} Tgas", needed.as_tgas()));

        let tx = self.build_tx(nonce.0, max_fee_per_gas.0, max_priority_fee_per_gas.0, gas_limit.0);
        let args = json!({
            "request": {
                "path": c.path,
                "payload_v2": { "Ecdsa": hex::encode(tx.payload) },
                "domain_id": MPC_SECP256K1_DOMAIN_ID,
            }
        });
        let mpc = c.mpc_contract.clone();
        self.leg = Leg::SignatureRequested { tx };
        log!("signature_requested nonce={}", nonce.0);

        // v1.signer refunds excess to us, not the caller: forward exactly `deposit`, refund the rest here (D-012).
        if attached > deposit {
            Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(attached - deposit)).detach();
        }
        Promise::new(mpc)
            .function_call("sign", args.to_string().into_bytes(), NearToken::from_yoctonear(deposit), sign_gas)
            .then(Self::ext(env::current_account_id()).with_static_gas(cb_gas).with_unused_gas_weight(0).on_signature(nonce))
    }

    /// Never panics on a bad/failed response: the leg always leaves `SignatureRequested`.
    #[private]
    pub fn on_signature(&mut self, nonce: U64, #[callback_result] result: Result<near_sdk::serde_json::Value, PromiseError>) -> bool {
        let Leg::SignatureRequested { tx } = self.leg.clone() else {
            log!("on_signature: no request in flight; ignored");
            return false;
        };
        if tx.nonce != nonce.0 {
            log!("on_signature: nonce {} does not match in-flight {}; ignored", nonce.0, tx.nonce);
            return false;
        }
        let outcome = result
            .map_err(|_| "sign failed or timed out".to_string())
            .and_then(|v| parse_mpc_signature(v.to_string().as_bytes()))
            .and_then(|sig| {
                let derived = self.derived_address.expect("checked before request");
                match recover_address(&tx.payload, &sig) {
                    Some(a) if a == derived => Ok(sig),
                    Some(a) => Err(format!("recovered signer {} != derived {}", to_hex(&a), to_hex(&derived))),
                    None => Err("ecrecover failed".into()),
                }
            });
        match outcome {
            Ok(sig) => {
                log!("signed nonce={} r={} y_parity={}", tx.nonce, to_hex(&sig.r), sig.y_parity);
                self.leg = Leg::Signed { tx, sig };
                true
            }
            Err(reason) => {
                log!("signature_failed nonce={}: {}", tx.nonce, reason);
                self.leg = Leg::Idle;
                false
            }
        }
    }

    // ---------- owner ----------

    pub fn set_mpc_params(&mut self, mpc_sign_deposit: U128, mpc_sign_gas_tgas: u64, callback_gas_tgas: u64) {
        require!(env::predecessor_account_id() == self.owner, "Unauthorized");
        require!(mpc_sign_gas_tgas > 0 && callback_gas_tgas > 0, "gas config must be > 0");
        self.config.mpc_sign_deposit = mpc_sign_deposit;
        self.config.mpc_sign_gas_tgas = mpc_sign_gas_tgas;
        self.config.callback_gas_tgas = callback_gas_tgas;
    }

    // ---------- views ----------

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_derived_address(&self) -> Option<String> {
        self.derived_address.map(|a| to_hex(&a))
    }

    pub fn get_leg(&self) -> LegView {
        match &self.leg {
            Leg::Idle => LegView::Idle,
            Leg::SignatureRequested { tx } => LegView::SignatureRequested { tx: tx_view(tx) },
            Leg::Signed { tx, sig } => LegView::Signed {
                tx: tx_view(tx),
                signature: SignatureView { r: to_hex(&sig.r), s: to_hex(&sig.s), y_parity: sig.y_parity },
            },
        }
    }

    /// What `request_signature` would sign for these fields, without signing.
    pub fn preview_tx(&self, nonce: U64, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, gas_limit: U64) -> TxView {
        tx_view(&self.build_tx(nonce.0, max_fee_per_gas.0, max_priority_fee_per_gas.0, gas_limit.0))
    }
}

impl TitleProof {
    /// D-002: `to`, `data`, `value`, `chain_id` come only from stored config.
    fn build_tx(&self, nonce: u64, max_fee_per_gas: u128, max_priority_fee_per_gas: u128, gas_limit: u64) -> StoredTx {
        build_title_tx(self.config.chain_id, nonce, max_fee_per_gas, max_priority_fee_per_gas, gas_limit, self.title_escrow, self.destination)
    }
}

/// Pure tx construction used by the contract and the reference-vector tests.
pub fn build_title_tx(
    chain_id: u64,
    nonce: u64,
    max_fee_per_gas: u128,
    max_priority_fee_per_gas: u128,
    gas_limit: u64,
    title_escrow: Address,
    destination: Address,
) -> StoredTx {
    let data = tradetrust::transfer_owners(&destination, &destination);
    let fields = Eip1559Fields { chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, gas_limit, to: title_escrow, value: 0, data: data.clone() };
    let payload = fields.signing_payload(keccak);
    StoredTx { chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, gas_limit, to: title_escrow, data, payload }
}

#[cfg(test)]
mod tests;
