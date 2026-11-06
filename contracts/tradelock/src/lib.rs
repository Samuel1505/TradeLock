//! Tradelock: bankless documents-against-payment on NEAR (docs/STATE_MACHINE.md is the spec).
//!
//! Cash leg: the buyer's stablecoin sits in this contract's NEAR Intents Verifier balance.
//! Title leg: the eBL's TitleEscrow is held by a per-deal EVM address derived by the MPC network for
//! this account; the contract builds the transfer tx itself (D-002) and asks `v1.signer` to sign it.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault};
use tradelock_evm::{parse_address, to_hex, Address};

mod cash;
mod confirm;
mod lifecycle;
mod title;
pub mod types;

pub use types::*;

/// secp256k1 signing domain on v1.signer (DECISIONS V-01).
pub const MPC_SECP256K1_DOMAIN_ID: u32 = 0;
pub const MIN_GAS_LIMIT: u64 = 21_000;
/// Gas for one Verifier call (mt_transfer / ft_withdraw incl. its internal ft_transfer + resolve).
pub const VERIFIER_CALL_GAS: Gas = Gas::from_tgas(50);
pub const CASH_CALLBACK_GAS: Gas = Gas::from_tgas(10);
pub const DERIVED_KEY_VIEW_GAS: Gas = Gas::from_tgas(10);
pub const DERIVED_KEY_CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// Own work around a cross-contract call.
pub const OWN_OVERHEAD: Gas = Gas::from_tgas(15);
/// Storage reserved per deal for later growth (votes, confirmations, legs), paid at create_deal.
pub const DEAL_STORAGE_RESERVE_BYTES: u64 = 3_000;
/// Cap on the per-deal confirmation log (oldest dropped).
pub const MAX_CONFIRMATION_RECORDS: usize = 24;

/// TitleEscrow factory allowed for a chain, with its clone implementation (D-021).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TitleFactory {
    pub chain_id: u64,
    pub factory: String,
    pub implementation: String,
}

/// TradeTrust registry allowed for deals, with the factory it was deployed with (D-021). The
/// TitleEscrow address depends on the registry's factory; an unlisted registry is rejected.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TitleRegistry {
    pub chain_id: u64,
    pub registry: String,
    pub factory: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner: AccountId,
    /// NEAR Intents Verifier holding the cash leg (our testnet instance, V-16).
    pub verifier: AccountId,
    pub mpc_contract: AccountId,
    /// Verifier token ids accepted as deal currency.
    pub allowed_tokens: Vec<String>,
    pub title_factories: Vec<TitleFactory>,
    /// registry → factory allowlist (D-021).
    pub title_registries: Vec<TitleRegistry>,
    /// Exact deposit forwarded to `sign` (D-012).
    pub mpc_sign_deposit: U128,
    pub mpc_sign_gas_tgas: u64,
    pub callback_gas_tgas: u64,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
    pub max_gas_limit: U64,
    /// Supplier must accept within this window after create_deal.
    pub acceptance_window_ns: U64,
    pub min_doc_window_ns: U64,
    pub max_doc_window_ns: U64,
    /// Pauses NEW deals only; never existing settlements.
    pub paused: bool,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Deals,
    DealsByAccount,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Tradelock {
    config: Config,
    deals: LookupMap<DealId, Deal>,
    deals_by_account: LookupMap<AccountId, Vec<DealId>>,
    next_deal_id: DealId,
}

// ---------- errors & events ----------

/// Stable error prefix + detail; tests assert on the prefix.
pub(crate) fn fail(code: &str, detail: impl AsRef<str>) -> ! {
    env::panic_str(&format!("{code}: {}", detail.as_ref()))
}

pub(crate) fn emit(event: &str, data: Value) {
    let ev = json!({ "standard": "tradelock", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{ev}"));
}

pub(crate) fn keccak(data: &[u8]) -> [u8; 32] {
    env::keccak256_array(data)
}

pub(crate) fn parse_evm(label: &str, s: &str) -> Address {
    let a = parse_address(s).unwrap_or_else(|e| fail("InvalidTerms", format!("{label}: {e}")));
    if a == [0u8; 20] {
        fail("InvalidTerms", format!("{label}: zero address"));
    }
    a
}

fn validate_title_config(factories: &[TitleFactory], registries: &[TitleRegistry]) {
    for f in factories {
        parse_evm("factory", &f.factory);
        parse_evm("implementation", &f.implementation);
    }
    for r in registries {
        parse_evm("registry", &r.registry);
        let fac = parse_evm("factory", &r.factory);
        if !factories.iter().any(|f| f.chain_id == r.chain_id && parse_evm("factory", &f.factory) == fac) {
            fail("InvalidTerms", format!("registry {} uses factory {} with no implementation entry on chain {}", r.registry, r.factory, r.chain_id));
        }
    }
}

pub(crate) fn deal_path(id: DealId) -> String {
    format!("tradelock/deal/{id}")
}

impl Tradelock {
    pub(crate) fn load(&self, id: DealId) -> Deal {
        self.deals.get(&id).cloned().unwrap_or_else(|| fail("DealNotFound", id.to_string()))
    }

    pub(crate) fn save(&mut self, deal: Deal) {
        self.deals.insert(deal.id, deal);
    }

    pub(crate) fn require_state(deal: &Deal, allowed: &[DealState]) {
        if !allowed.contains(&deal.state) {
            fail("InvalidState", format!("expected {allowed:?}, actual {:?}", deal.state));
        }
    }

    pub(crate) fn require_caller(deal: &Deal, party: Party) {
        if deal.party_of(&env::predecessor_account_id()) != Some(party) {
            fail("Unauthorized", format!("only the {party:?} may call this"));
        }
    }

    pub(crate) fn require_gas(needed: Gas) {
        if env::prepaid_gas() < needed {
            fail("InsufficientGas", format!("attach at least {} Tgas", needed.as_tgas()));
        }
    }

    pub(crate) fn transition(deal: &mut Deal, to: DealState, event: &str) {
        let from = deal.state;
        deal.state = to;
        emit(event, json!({ "deal_id": U64(deal.id), "from": from, "to": to }));
    }

    fn require_owner(&self) {
        if env::predecessor_account_id() != self.config.owner {
            fail("Unauthorized", "owner only");
        }
    }
}

#[near]
impl Tradelock {
    #[init]
    pub fn new(config: Config) -> Self {
        require!(config.mpc_sign_gas_tgas > 0 && config.callback_gas_tgas > 0, "gas config must be > 0");
        require!(config.max_priority_fee_per_gas.0 <= config.max_fee_per_gas.0, "priority fee bound above max fee bound");
        require!(config.max_gas_limit.0 >= MIN_GAS_LIMIT, "max_gas_limit below 21000");
        require!(config.min_doc_window_ns.0 > 0 && config.min_doc_window_ns.0 <= config.max_doc_window_ns.0, "invalid doc window bounds");
        validate_title_config(&config.title_factories, &config.title_registries);
        Self {
            config,
            deals: LookupMap::new(StorageKey::Deals),
            deals_by_account: LookupMap::new(StorageKey::DealsByAccount),
            next_deal_id: 0,
        }
    }

    // ---------- owner (cannot touch deals) ----------

    pub fn set_allowed_tokens(&mut self, tokens: Vec<String>) {
        self.require_owner();
        self.config.allowed_tokens = tokens;
    }

    /// Replace both title allowlists together so every registry's factory has an implementation.
    pub fn set_title_config(&mut self, factories: Vec<TitleFactory>, registries: Vec<TitleRegistry>) {
        self.require_owner();
        validate_title_config(&factories, &registries);
        self.config.title_factories = factories;
        self.config.title_registries = registries;
    }

    pub fn set_mpc_params(&mut self, mpc_sign_deposit: U128, mpc_sign_gas_tgas: u64, callback_gas_tgas: u64) {
        self.require_owner();
        require!(mpc_sign_gas_tgas > 0 && callback_gas_tgas > 0, "gas config must be > 0");
        self.config.mpc_sign_deposit = mpc_sign_deposit;
        self.config.mpc_sign_gas_tgas = mpc_sign_gas_tgas;
        self.config.callback_gas_tgas = callback_gas_tgas;
    }

    pub fn set_fee_bounds(&mut self, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, max_gas_limit: U64) {
        self.require_owner();
        require!(max_priority_fee_per_gas.0 <= max_fee_per_gas.0, "priority fee bound above max fee bound");
        require!(max_gas_limit.0 >= MIN_GAS_LIMIT, "max_gas_limit below 21000");
        self.config.max_fee_per_gas = max_fee_per_gas;
        self.config.max_priority_fee_per_gas = max_priority_fee_per_gas;
        self.config.max_gas_limit = max_gas_limit;
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.require_owner();
        self.config.paused = paused;
    }

    // ---------- views ----------

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_deal(&self, deal_id: U64) -> Option<DealView> {
        self.deals.get(&deal_id.0).map(view_deal)
    }

    pub fn get_deals_by_account(&self, account_id: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<DealView> {
        let ids = self.deals_by_account.get(&account_id).cloned().unwrap_or_default();
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(50).min(100) as usize;
        ids.iter().skip(from).take(limit).filter_map(|id| self.deals.get(id).map(view_deal)).collect()
    }

    pub fn get_next_deal_id(&self) -> U64 {
        U64(self.next_deal_id)
    }

    pub fn derivation_path(&self, deal_id: U64) -> String {
        deal_path(deal_id.0)
    }
}

pub(crate) fn tx_view(tx: &StoredTx) -> TxView {
    let fields = title::fields_of(tx);
    TxView {
        chain_id: tx.chain_id,
        nonce: U64(tx.nonce),
        max_priority_fee_per_gas: U128(tx.max_priority_fee_per_gas),
        max_fee_per_gas: U128(tx.max_fee_per_gas),
        gas_limit: U64(tx.gas_limit),
        to: to_hex(&tx.to),
        value: U128(0),
        data: to_hex(&tx.data),
        unsigned_tx: to_hex(&fields.unsigned_bytes()),
        payload: to_hex(&tx.payload),
    }
}

pub(crate) fn leg_view(leg: &TitleLeg) -> TitleLegView {
    let sig_view = |s: &EvmSignature| SignatureView { r: to_hex(&s.r), s: to_hex(&s.s), y_parity: s.y_parity };
    match leg {
        TitleLeg::NotApplicable => TitleLegView::NotApplicable,
        TitleLeg::Pending => TitleLegView::Pending,
        TitleLeg::SignatureRequested { tx } => TitleLegView::SignatureRequested { tx: tx_view(tx) },
        TitleLeg::Signed { tx, sig } => TitleLegView::Signed { tx: tx_view(tx), signature: sig_view(sig) },
        TitleLeg::Broadcast { tx, sig, tx_hash } => {
            TitleLegView::Broadcast { tx: tx_view(tx), signature: sig_view(sig), tx_hash: tx_hash.clone() }
        }
        TitleLeg::Done => TitleLegView::Done,
    }
}

fn view_deal(d: &Deal) -> DealView {
    let (mode, ebl, deliver_by) = match &d.mode {
        Mode::Ebl(t) => (
            "ebl",
            Some(EblView {
                chain_id: t.chain_id,
                factory: to_hex(&t.factory),
                registry: to_hex(&t.registry),
                token_id: t.token_id_dec.clone(),
                title_escrow: to_hex(&t.title_escrow),
                buyer_evm: to_hex(&t.buyer_evm),
                supplier_evm: to_hex(&t.supplier_evm),
                ship_by: U64(t.ship_by),
                doc_acceptance_window_ns: U64(t.doc_acceptance_window_ns),
                derived_address: t.derived_address.map(|a| to_hex(&a)),
                derivation_path: deal_path(d.id),
                accept_by: t.accept_by.map(U64),
            }),
            None,
        ),
        Mode::EscrowOnly { deliver_by } => ("escrow_only", None, Some(U64(*deliver_by))),
    };
    DealView {
        id: U64(d.id),
        buyer: d.buyer.clone(),
        supplier: d.supplier.clone(),
        arbiter: d.arbiter.clone(),
        token_id: d.token_id.clone(),
        amount: U128(d.amount),
        order_hash: hex::encode(d.order_hash),
        payout: d.payout.clone(),
        mode,
        ebl,
        deliver_by,
        state: d.state,
        accepted: d.accepted,
        created_at: U64(d.created_at),
        cash_leg: d.cash,
        title_leg: leg_view(&d.title),
        disputed: d.disputed,
        votes: d.votes.clone(),
        open_fact: confirm::open_fact(d),
        pending_confirmers: d.pending_confirmers.clone(),
        confirmations: d.confirmations.clone(),
        redelivery: d.redelivery.as_ref().map(|r| RedeliveryView { leg: leg_view(&r.leg), requested: r.requested, round: r.round }),
    }
}

#[cfg(test)]
mod tests;
