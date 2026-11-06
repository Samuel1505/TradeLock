//! Title leg: derived address (D-013), in-contract tx construction (D-002), MPC signature with
//! on-chain ecrecover check (D-016), broadcast report. Completion is by confirmation (confirm.rs).

use crate::*;
use near_sdk::{Promise, PromiseError};
use tradelock_evm::address::evm_address_from_naj;
use tradelock_evm::tradetrust::transfer_owners;
use tradelock_evm::tx::Eip1559Fields;

pub(crate) fn fields_of(tx: &StoredTx) -> Eip1559Fields {
    Eip1559Fields {
        chain_id: tx.chain_id,
        nonce: tx.nonce,
        max_priority_fee_per_gas: tx.max_priority_fee_per_gas,
        max_fee_per_gas: tx.max_fee_per_gas,
        gas_limit: tx.gas_limit,
        to: tx.to,
        value: 0,
        data: tx.data.clone(),
    }
}

/// D-002: everything except nonce and fees comes from stored deal terms.
pub(crate) fn build_title_tx(t: &EblTerms, dest: Address, nonce: u64, max_fee: u128, max_priority: u128, gas_limit: u64) -> StoredTx {
    let data = transfer_owners(&dest, &dest);
    let fields = Eip1559Fields {
        chain_id: t.chain_id,
        nonce,
        max_priority_fee_per_gas: max_priority,
        max_fee_per_gas: max_fee,
        gas_limit,
        to: t.title_escrow,
        value: 0,
        data: data.clone(),
    };
    let payload = fields.signing_payload(keccak);
    StoredTx { chain_id: t.chain_id, nonce, max_priority_fee_per_gas: max_priority, max_fee_per_gas: max_fee, gas_limit, to: t.title_escrow, data, payload }
}

#[near(serializers = [json])]
struct MpcSignature {
    scheme: String,
    big_r: MpcPoint,
    s: MpcScalar,
    recovery_id: u8,
}
#[near(serializers = [json])]
struct MpcPoint {
    affine_point: String,
}
#[near(serializers = [json])]
struct MpcScalar {
    scalar: String,
}

pub(crate) fn parse_mpc_signature(v: &serde_json::Value) -> Result<EvmSignature, String> {
    let sig: MpcSignature = serde_json::from_value(v.clone()).map_err(|e| format!("bad MPC response: {e}"))?;
    if sig.scheme != "Secp256k1" {
        return Err(format!("unexpected scheme {}", sig.scheme));
    }
    let big_r = hex::decode(&sig.big_r.affine_point).map_err(|e| format!("big_r hex: {e}"))?;
    if big_r.len() != 33 || !(big_r[0] == 2 || big_r[0] == 3) {
        return Err("big_r must be a 33-byte compressed point".into());
    }
    let s: [u8; 32] = hex::decode(&sig.s.scalar).map_err(|e| format!("s hex: {e}"))?.try_into().map_err(|_| "s must be 32 bytes".to_string())?;
    if sig.recovery_id > 1 {
        return Err(format!("recovery_id {} out of range", sig.recovery_id));
    }
    let mut r = [0u8; 32];
    r.copy_from_slice(&big_r[1..]);
    Ok(EvmSignature { r, s, y_parity: sig.recovery_id })
}

/// ecrecover host function; malleability_flag rejects high-s (EIP-2).
pub(crate) fn recover_address(payload: &[u8; 32], sig: &EvmSignature) -> Option<Address> {
    let mut rs = [0u8; 64];
    rs[..32].copy_from_slice(&sig.r);
    rs[32..].copy_from_slice(&sig.s);
    let pk = env::ecrecover(payload, &rs, sig.y_parity, true)?;
    let h = keccak(&pk);
    let mut a = [0u8; 20];
    a.copy_from_slice(&h[12..]);
    Some(a)
}

fn valid_tx_hash(h: &str) -> bool {
    h.len() == 66 && h.starts_with("0x") && h[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

impl Tradelock {
    pub(crate) fn fetch_derived_address(&self, deal_id: DealId) -> Promise {
        let args = json!({ "path": deal_path(deal_id), "predecessor": env::current_account_id(), "domain_id": MPC_SECP256K1_DOMAIN_ID });
        Promise::new(self.config.mpc_contract.clone())
            .function_call("derived_public_key", args.to_string().into_bytes(), NearToken::from_yoctonear(0), DERIVED_KEY_VIEW_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(DERIVED_KEY_CALLBACK_GAS).with_unused_gas_weight(0).on_derived_public_key(U64(deal_id)))
    }

    /// The title leg `request_title_signature` / `report_broadcast` act on, with its destination.
    fn target_leg(deal: &Deal) -> (LegKind, Address) {
        let dest = deal.title_dest().unwrap_or_else(|| fail("InvalidState", format!("no title transfer in state {:?}", deal.state)));
        match deal.state {
            DealState::Settling | DealState::Refunding => (LegKind::Main, dest),
            DealState::Settled | DealState::Refunded => match &deal.redelivery {
                Some(r) if r.requested => (LegKind::Redelivery, dest),
                _ => fail("InvalidState", "no redelivery requested"),
            },
            _ => fail("InvalidState", format!("no title transfer in state {:?}", deal.state)),
        }
    }

    fn leg_mut(deal: &mut Deal, kind: LegKind) -> &mut TitleLeg {
        match kind {
            LegKind::Main => &mut deal.title,
            LegKind::Redelivery => &mut deal.redelivery.as_mut().unwrap_or_else(|| fail("InvalidState", "no redelivery")).leg,
        }
    }
}

#[near]
impl Tradelock {
    /// D-013 callback. Never panics on a bad response (logs; refresh_derived_address retries).
    #[private]
    pub fn on_derived_public_key(&mut self, deal_id: U64, #[callback_result] key: Result<String, PromiseError>) -> Option<String> {
        let mut deal = self.load(deal_id.0);
        let addr = match key.map_err(|_| "derived_public_key call failed".to_string()).and_then(|k| evm_address_from_naj(&k, keccak)) {
            Ok(a) => a,
            Err(e) => {
                emit("derived_address_failed", json!({ "deal_id": deal_id, "error": e }));
                return None;
            }
        };
        let t = deal.ebl_mut()?;
        if let Some(existing) = t.derived_address {
            if existing != addr {
                emit("derived_address_failed", json!({ "deal_id": deal_id, "error": "derived address changed; refusing to overwrite" }));
                return None;
            }
            return Some(to_hex(&existing));
        }
        t.derived_address = Some(addr);
        emit("derived_address", json!({ "deal_id": deal_id, "address": to_hex(&addr), "path": deal_path(deal_id.0) }));
        self.save(deal);
        Some(to_hex(&addr))
    }

    /// #1a. Re-issue the MPC view if the create_deal callback failed.
    pub fn refresh_derived_address(&mut self, deal_id: U64) -> Promise {
        let deal = self.load(deal_id.0);
        let t = deal.ebl().unwrap_or_else(|| fail("InvalidState", "escrow-only deal has no title leg"));
        if t.derived_address.is_some() {
            fail("InvalidState", "derived address already stored");
        }
        Self::require_gas(DERIVED_KEY_VIEW_GAS.saturating_add(DERIVED_KEY_CALLBACK_GAS).saturating_add(OWN_OVERHEAD));
        self.fetch_derived_address(deal_id.0)
    }

    /// Executor (anyone): build the transfer tx in-contract and ask the MPC to sign it.
    /// Attach at least `config.mpc_sign_deposit`; excess is refunded (D-012).
    #[payable]
    pub fn request_title_signature(&mut self, deal_id: U64, nonce: U64, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, gas_limit: U64) -> Promise {
        let mut deal = self.load(deal_id.0);
        let (kind, dest) = Self::target_leg(&deal);
        {
            let leg = Self::leg_mut(&mut deal, kind);
            match leg {
                TitleLeg::Pending | TitleLeg::Signed { .. } | TitleLeg::Broadcast { .. } => {}
                TitleLeg::SignatureRequested { .. } => fail("LegInFlight", "a signature request is in flight"),
                TitleLeg::Done | TitleLeg::NotApplicable => fail("InvalidState", "title leg is complete or not applicable"),
            }
        }
        let c = &self.config;
        if max_priority_fee_per_gas.0 > max_fee_per_gas.0 {
            fail("FeeOutOfBounds", "priority fee > max fee");
        }
        if max_fee_per_gas.0 == 0 || max_fee_per_gas.0 > c.max_fee_per_gas.0 {
            fail("FeeOutOfBounds", "max_fee_per_gas");
        }
        if max_priority_fee_per_gas.0 > c.max_priority_fee_per_gas.0 {
            fail("FeeOutOfBounds", "max_priority_fee_per_gas");
        }
        if gas_limit.0 < MIN_GAS_LIMIT || gas_limit.0 > c.max_gas_limit.0 {
            fail("FeeOutOfBounds", "gas_limit");
        }
        let deposit = c.mpc_sign_deposit.0;
        let attached = env::attached_deposit().as_yoctonear();
        if attached < deposit {
            fail("InsufficientDeposit", format!("attach at least {deposit} yoctoNEAR"));
        }
        let sign_gas = Gas::from_tgas(c.mpc_sign_gas_tgas);
        let cb_gas = Gas::from_tgas(c.callback_gas_tgas);
        Self::require_gas(sign_gas.saturating_add(cb_gas).saturating_add(OWN_OVERHEAD));
        let t = deal.ebl().unwrap_or_else(|| fail("InvalidState", "no title leg")).clone();
        if t.derived_address.is_none() {
            fail("DerivedAddressMissing", "derived address not stored");
        }
        let tx = build_title_tx(&t, dest, nonce.0, max_fee_per_gas.0, max_priority_fee_per_gas.0, gas_limit.0);
        let args = json!({ "request": { "path": deal_path(deal.id), "payload_v2": { "Ecdsa": hex::encode(tx.payload) }, "domain_id": MPC_SECP256K1_DOMAIN_ID } });
        let mpc = c.mpc_contract.clone();
        *Self::leg_mut(&mut deal, kind) = TitleLeg::SignatureRequested { tx };
        emit("title_leg_progress", json!({ "deal_id": deal_id, "leg": kind, "status": "SignatureRequested", "nonce": nonce }));
        self.save(deal);
        if attached > deposit {
            Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(attached - deposit)).detach();
        }
        Promise::new(mpc)
            .function_call("sign", args.to_string().into_bytes(), NearToken::from_yoctonear(deposit), sign_gas)
            .then(Self::ext(env::current_account_id()).with_static_gas(cb_gas).with_unused_gas_weight(0).on_signature(deal_id, kind, nonce))
    }

    /// Stores the signature only if ecrecover yields the deal's derived address (D-016). Never panics.
    #[private]
    pub fn on_signature(&mut self, deal_id: U64, kind: LegKind, nonce: U64, #[callback_result] result: Result<serde_json::Value, PromiseError>) -> bool {
        let mut deal = self.load(deal_id.0);
        let derived = deal.ebl().and_then(|t| t.derived_address);
        let current = match kind {
            LegKind::Main => Some(deal.title.clone()),
            LegKind::Redelivery => deal.redelivery.as_ref().map(|r| r.leg.clone()),
        };
        let Some(TitleLeg::SignatureRequested { tx }) = current else {
            return false; // leg moved on (e.g. confirmed Done meanwhile)
        };
        if tx.nonce != nonce.0 {
            return false;
        }
        let outcome = result
            .map_err(|_| "sign failed or timed out".to_string())
            .and_then(|v| parse_mpc_signature(&v))
            .and_then(|sig| match (recover_address(&tx.payload, &sig), derived) {
                (Some(a), Some(d)) if a == d => Ok(sig),
                (Some(a), Some(d)) => Err(format!("recovered {} != derived {}", to_hex(&a), to_hex(&d))),
                _ => Err("ecrecover failed".into()),
            });
        let (leg, ok) = match outcome {
            Ok(sig) => (TitleLeg::Signed { tx, sig }, true),
            Err(e) => {
                emit("title_leg_progress", json!({ "deal_id": deal_id, "leg": kind, "status": "Pending", "error": e }));
                (TitleLeg::Pending, false)
            }
        };
        *Self::leg_mut(&mut deal, kind) = leg;
        if ok {
            emit("title_leg_progress", json!({ "deal_id": deal_id, "leg": kind, "status": "Signed", "nonce": nonce }));
        }
        self.save(deal);
        ok
    }

    /// Informational (anyone): the executor broadcast the signed tx. Never completes a leg.
    pub fn report_broadcast(&mut self, deal_id: U64, tx_hash: String) {
        if !valid_tx_hash(&tx_hash) {
            fail("InvalidTerms", "tx_hash must be 0x + 64 hex");
        }
        let mut deal = self.load(deal_id.0);
        let (kind, _) = Self::target_leg(&deal);
        let leg = Self::leg_mut(&mut deal, kind);
        *leg = match leg.clone() {
            TitleLeg::Signed { tx, sig } | TitleLeg::Broadcast { tx, sig, .. } => TitleLeg::Broadcast { tx, sig, tx_hash: tx_hash.clone() },
            _ => fail("InvalidState", "no signed transaction to report"),
        };
        emit("title_leg_progress", json!({ "deal_id": deal_id, "leg": kind, "status": "Broadcast", "tx_hash": tx_hash }));
        self.save(deal);
    }

    /// What request_title_signature would sign now for these fields (no state change).
    pub fn preview_title_tx(&self, deal_id: U64, nonce: U64, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, gas_limit: U64) -> TxView {
        let deal = self.load(deal_id.0);
        let dest = deal.title_dest().unwrap_or_else(|| fail("InvalidState", "no title transfer in this state"));
        let t = deal.ebl().unwrap_or_else(|| fail("InvalidState", "no title leg"));
        tx_view(&build_title_tx(t, dest, nonce.0, max_fee_per_gas.0, max_priority_fee_per_gas.0, gas_limit.0))
    }
}
