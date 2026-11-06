//! NEAR "secp256k1:<base58>" public key (as returned by `v1.signer.derived_public_key`) → EVM address.
//! The key is the uncompressed 64-byte x‖y (verified 2026-11-04, D-013), so no curve math is needed.

use crate::Address;

pub const SECP256K1_PREFIX: &str = "secp256k1:";

/// Decode and validate the 64-byte uncompressed key.
pub fn decode_secp256k1_naj(key: &str) -> Result<[u8; 64], String> {
    let b58 = key
        .strip_prefix(SECP256K1_PREFIX)
        .ok_or_else(|| format!("expected '{SECP256K1_PREFIX}' key, got: {key}"))?;
    let bytes = bs58::decode(b58).into_vec().map_err(|e| format!("invalid base58 key: {e}"))?;
    bytes
        .try_into()
        .map_err(|b: Vec<u8>| format!("expected 64-byte uncompressed key, got {} bytes", b.len()))
}

/// address = keccak256(x‖y)[12..].
pub fn evm_address_from_naj(key: &str, keccak256: impl FnOnce(&[u8]) -> [u8; 32]) -> Result<Address, String> {
    let xy = decode_secp256k1_naj(key)?;
    let h = keccak256(&xy);
    let mut out = [0u8; 20];
    out.copy_from_slice(&h[12..]);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_wrong_prefix_and_length() {
        assert!(decode_secp256k1_naj("ed25519:abc").is_err());
        // 33 bytes (compressed) must be rejected, not silently accepted.
        let compressed = bs58::encode([2u8; 33]).into_string();
        let err = decode_secp256k1_naj(&format!("secp256k1:{compressed}")).unwrap_err();
        assert!(err.contains("64-byte"), "{err}");
    }
}
