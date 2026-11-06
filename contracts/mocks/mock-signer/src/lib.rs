//! TEST ONLY (S-05). MockSigner mimics `v1.signer` for sandbox tests: `derived_public_key` and `sign`
//! with near/mpc's epsilon derivation (`derive_tweak`: sha3_256("near-mpc-recovery v0.1.0 epsilon
//! derivation:" ‖ predecessor ‖ "," ‖ path); child = root + tweak·G) but a fixed, public root key.
//! It answers synchronously instead of yield/resume. `set_fail(true)` makes `sign` panic.

use k256::ecdsa::SigningKey;
use k256::elliptic_curve::ops::Reduce;
use k256::elliptic_curve::PrimeField;
use k256::{Scalar, U256};
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, require, AccountId};
use sha3::{Digest, Sha3_256};

const ROOT_SECRET: [u8; 32] = [0x42; 32];
const PREFIX: &str = "near-mpc-recovery v0.1.0 epsilon derivation:";

#[near(contract_state)]
#[derive(Default)]
pub struct MockSigner {
    fail: bool,
}

fn derived_key(predecessor: &str, path: &str) -> SigningKey {
    let tweak: [u8; 32] = Sha3_256::digest(format!("{PREFIX}{predecessor},{path}").as_bytes()).into();
    let t = <Scalar as Reduce<U256>>::reduce_bytes(&tweak.into());
    let root = Scalar::from_repr(ROOT_SECRET.into()).unwrap();
    SigningKey::from_bytes(&(root + t).to_bytes()).unwrap()
}

#[near(serializers = [json])]
pub struct SignRequest {
    pub path: String,
    pub payload_v2: Value,
    pub domain_id: u32,
}

#[near]
impl MockSigner {
    pub fn set_fail(&mut self, fail: bool) {
        self.fail = fail;
    }

    pub fn derived_public_key(&self, path: String, predecessor: AccountId, domain_id: u32) -> String {
        require!(domain_id == 0, "MockSigner supports domain 0 only");
        let k = derived_key(predecessor.as_str(), &path);
        let point = k.verifying_key().to_encoded_point(false);
        format!("secp256k1:{}", bs58::encode(&point.as_bytes()[1..]).into_string())
    }

    #[payable]
    pub fn sign(&mut self, request: SignRequest) -> Value {
        require!(!self.fail, "MockSigner: configured to fail");
        require!(env::attached_deposit().as_yoctonear() >= 1, "attach 1 yoctoNEAR");
        require!(request.domain_id == 0, "domain 0 only");
        let hex_payload = request.payload_v2.get("Ecdsa").and_then(|v| v.as_str()).unwrap_or_else(|| env::panic_str("payload_v2.Ecdsa missing"));
        let payload: [u8; 32] = hex::decode(hex_payload).ok().and_then(|v| v.try_into().ok()).unwrap_or_else(|| env::panic_str("bad payload"));
        let k = derived_key(env::predecessor_account_id().as_str(), &request.path);
        let (sig, recid) = k.sign_prehash_recoverable(&payload).unwrap_or_else(|_| env::panic_str("sign failed"));
        let bytes = sig.to_bytes();
        let mut big_r = vec![2 + recid.is_y_odd() as u8];
        big_r.extend_from_slice(&bytes[..32]);
        json!({
            "scheme": "Secp256k1",
            "big_r": { "affine_point": hex::encode(big_r) },
            "s": { "scalar": hex::encode(&bytes[32..]) },
            "recovery_id": recid.to_byte(),
        })
    }
}
