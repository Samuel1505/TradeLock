//! Deal data model (STATE_MACHINE.md). Stored types are borsh; JSON views are separate.

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};
use tradelock_evm::{to_hex, Address};

pub type DealId = u64;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DealState {
    Created,
    Funded,
    TitleHeld,
    Settling,
    Settled,
    Disputed,
    Refunding,
    Refunded,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Party {
    Buyer,
    Supplier,
    Arbiter,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Release,
    Refund,
}

/// Where the supplier's payout goes. `Internal` = Verifier balance of `account` (`mt_transfer`);
/// `Withdraw` = NEP-141 `ft_withdraw` from the Verifier to `account` on the token contract.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum PayoutTarget {
    Internal { account: AccountId },
    Withdraw { account: AccountId },
}

// ---------- create_deal input ----------

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct DealTerms {
    pub supplier: AccountId,
    pub arbiter: AccountId,
    /// Verifier token id, e.g. "nep141:usdc.tradelock.testnet".
    pub token_id: String,
    pub amount: U128,
    /// sha256 of the order document, 64 hex chars. Never the contents.
    pub order_hash: String,
    pub payout: PayoutTarget,
    pub mode: TermsMode,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub enum TermsMode {
    Ebl {
        chain_id: u64,
        /// Must be in the owner's registry allowlist; its factory comes from there (D-021).
        registry: String,
        /// uint256 token id, decimal.
        token_id: String,
        buyer_evm: String,
        supplier_evm: String,
        ship_by: U64,
        doc_acceptance_window_ns: U64,
    },
    EscrowOnly {
        deliver_by: U64,
    },
}

// ---------- stored ----------

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct EblTerms {
    pub chain_id: u64,
    pub factory: Address,
    pub registry: Address,
    pub token_id: [u8; 32],
    pub token_id_dec: String,
    /// Computed at create_deal from (factory, implementation, registry, token_id) — D-021.
    pub title_escrow: Address,
    pub buyer_evm: Address,
    pub supplier_evm: Address,
    pub ship_by: u64,
    pub doc_acceptance_window_ns: u64,
    /// From v1.signer.derived_public_key (D-013); None until the callback lands.
    pub derived_address: Option<Address>,
    /// Set on entering TitleHeld (D-020).
    pub accept_by: Option<u64>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum Mode {
    Ebl(EblTerms),
    EscrowOnly { deliver_by: u64 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CashLeg {
    Pending,
    TransferRequested,
    Done,
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

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct EvmSignature {
    pub r: [u8; 32],
    pub s: [u8; 32],
    pub y_parity: u8,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum TitleLeg {
    NotApplicable,
    Pending,
    SignatureRequested { tx: StoredTx },
    Signed { tx: StoredTx, sig: EvmSignature },
    Broadcast { tx: StoredTx, sig: EvmSignature, tx_hash: String },
    Done,
}

impl TitleLeg {
    pub fn is_complete(&self) -> bool {
        matches!(self, TitleLeg::Done | TitleLeg::NotApplicable)
    }
}

/// Which title leg an operation targets.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LegKind {
    Main,
    Redelivery,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Redelivery {
    pub leg: TitleLeg,
    /// Set by `redeliver_title`; signing is allowed only after the entitled party requests it.
    pub requested: bool,
    pub round: u32,
}

/// Facts the contract cannot read itself (D-019, STATE_MACHINE §5a).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fact {
    /// holder = beneficiary = deal-derived address, in Funded.
    TitleHeld,
    /// holder = beneficiary = leg destination (main leg or redelivery).
    TitleTransferred,
    /// holder = beneficiary = deal-derived address, after Settled/Refunded.
    TitleAtDealAddress,
}

/// What a confirmer saw on Sepolia (re-checkable by anyone). `holder` and `beneficiary` must both
/// equal the address the fact expects (D-019); the block may differ between confirmers (D-021).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Evidence {
    pub holder: String,
    pub beneficiary: String,
    pub block_number: U64,
    pub tx_hash: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ConfirmationRecord {
    pub fact: Fact,
    pub party: Party,
    pub evidence: Evidence,
    pub at: U64,
    /// true on the confirmation that made the fact accepted.
    pub accepted: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Votes {
    pub buyer: Option<Decision>,
    pub supplier: Option<Decision>,
    pub arbiter: Option<Decision>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Deal {
    pub id: DealId,
    pub buyer: AccountId,
    pub supplier: AccountId,
    pub arbiter: AccountId,
    pub token_id: String,
    pub amount: u128,
    pub order_hash: [u8; 32],
    pub payout: PayoutTarget,
    pub mode: Mode,
    pub state: DealState,
    pub accepted: bool,
    pub created_at: u64,
    pub cash: CashLeg,
    pub title: TitleLeg,
    pub disputed: bool,
    pub disputed_with_title: bool,
    pub votes: Votes,
    /// Open single confirmations for the current fact (cleared when the fact is accepted or changes).
    pub pending_fact: Option<Fact>,
    pub pending_confirmers: Vec<Party>,
    /// Append-only (capped) record of every confirmation, for re-checking on Sepolia.
    pub confirmations: Vec<ConfirmationRecord>,
    pub redelivery: Option<Redelivery>,
}

impl Deal {
    pub fn party_of(&self, account: &AccountId) -> Option<Party> {
        if account == &self.buyer {
            Some(Party::Buyer)
        } else if account == &self.supplier {
            Some(Party::Supplier)
        } else if account == &self.arbiter {
            Some(Party::Arbiter)
        } else {
            None
        }
    }

    pub fn ebl(&self) -> Option<&EblTerms> {
        match &self.mode {
            Mode::Ebl(t) => Some(t),
            Mode::EscrowOnly { .. } => None,
        }
    }

    pub fn ebl_mut(&mut self) -> Option<&mut EblTerms> {
        match &mut self.mode {
            Mode::Ebl(t) => Some(t),
            Mode::EscrowOnly { .. } => None,
        }
    }

    /// Title destination for the current direction (D-002: never caller-supplied).
    pub fn title_dest(&self) -> Option<Address> {
        let t = self.ebl()?;
        match self.state {
            DealState::Settling | DealState::Settled => Some(t.buyer_evm),
            DealState::Refunding | DealState::Refunded => Some(t.supplier_evm),
            _ => None,
        }
    }
}

// ---------- views ----------

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
    pub unsigned_tx: String,
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
pub enum TitleLegView {
    NotApplicable,
    Pending,
    SignatureRequested { tx: TxView },
    Signed { tx: TxView, signature: SignatureView },
    Broadcast { tx: TxView, signature: SignatureView, tx_hash: String },
    Done,
}

#[near(serializers = [json])]
pub struct EblView {
    pub chain_id: u64,
    pub factory: String,
    pub registry: String,
    pub token_id: String,
    pub title_escrow: String,
    pub buyer_evm: String,
    pub supplier_evm: String,
    pub ship_by: U64,
    pub doc_acceptance_window_ns: U64,
    pub derived_address: Option<String>,
    pub derivation_path: String,
    pub accept_by: Option<U64>,
}

#[near(serializers = [json])]
pub struct RedeliveryView {
    pub leg: TitleLegView,
    pub requested: bool,
    pub round: u32,
}

#[near(serializers = [json])]
pub struct DealView {
    pub id: U64,
    pub buyer: AccountId,
    pub supplier: AccountId,
    pub arbiter: AccountId,
    pub token_id: String,
    pub amount: U128,
    pub order_hash: String,
    pub payout: PayoutTarget,
    pub mode: &'static str,
    pub ebl: Option<EblView>,
    pub deliver_by: Option<U64>,
    pub state: DealState,
    pub accepted: bool,
    pub created_at: U64,
    pub cash_leg: CashLeg,
    pub title_leg: TitleLegView,
    pub disputed: bool,
    pub votes: Votes,
    pub open_fact: Option<Fact>,
    pub pending_confirmers: Vec<Party>,
    pub confirmations: Vec<ConfirmationRecord>,
    pub redelivery: Option<RedeliveryView>,
}

pub fn addr_hex(a: &Address) -> String {
    to_hex(a)
}
