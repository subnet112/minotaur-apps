/**
 * Order-owner signature helpers (M3 + M4 from subnet audit 2026-05-25).
 *
 * Three order-modifying endpoints — DELETE /orders/{id},
 * PATCH /orders/{id}/tx-confirmed, PATCH /orders/{id}/signature — now
 * require an EIP-191 personal_sign by the order's `submitted_by` address
 * over a domain-separated action payload. This module builds the digest
 * the server expects and wraps signer.signMessage() so callers don't have
 * to know the wire format.
 *
 * Mirrors `minotaur_subnet/consensus/order_owner_sig.py` byte-for-byte.
 */
import { AbiCoder, keccak256, toUtf8Bytes, getBytes, type Signer } from 'ethers'

/** 32-byte domain tag — matches DOMAIN_TAG in order_owner_sig.py. */
const DOMAIN_TAG = bytes32FromAscii('Minotaur Order Action v1')

/** 32-byte action tags — match ACTION_* constants in order_owner_sig.py. */
const ACTION_CANCEL = bytes32FromAscii('Cancel')
const ACTION_CONFIRM_TX = bytes32FromAscii('ConfirmTx')
const ACTION_ATTACH_SIG = bytes32FromAscii('AttachSig')

/** Default deadline window — server caps at 24h ahead; 5min is plenty. */
const DEFAULT_DEADLINE_SECONDS_AHEAD = 300

export interface OwnerSignatureResult {
  ownerSignature: string
  deadline: number
}

/** Hex of `content` UTF-8-encoded then keccak256'd. Matches `content_hash_of()`. */
export function contentHashOf(content: string | null | undefined): string {
  if (!content) return '0x' + '0'.repeat(64)
  return keccak256(toUtf8Bytes(content))
}

/**
 * Compute the digest the server's `_digest()` produces and have `signer`
 * personal_sign it. Returned hex signature + matching deadline are what
 * the API expects as `owner_signature` and `deadline`.
 */
export async function signOrderAction(
  signer: Signer,
  params: {
    action: 'Cancel' | 'ConfirmTx' | 'AttachSig'
    orderId: string
    /** Hex-encoded 32-byte content hash. Empty/missing → all-zeros. */
    contentHash?: string
    chainId: number
    /** Override deadline; otherwise now + DEFAULT_DEADLINE_SECONDS_AHEAD. */
    deadline?: number
  },
): Promise<OwnerSignatureResult> {
  const actionTag = {
    Cancel: ACTION_CANCEL,
    ConfirmTx: ACTION_CONFIRM_TX,
    AttachSig: ACTION_ATTACH_SIG,
  }[params.action]

  const deadline =
    params.deadline ?? Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS_AHEAD
  const contentHash = params.contentHash ?? ('0x' + '0'.repeat(64))

  // abi.encode(bytes32, bytes32, bytes, bytes32, uint64, uint256) — order_id
  // is variable-length `bytes` (utf-8 of the order id string), NOT a bytes32.
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'bytes32', 'bytes', 'bytes32', 'uint64', 'uint256'],
    [DOMAIN_TAG, actionTag, toUtf8Bytes(params.orderId), contentHash, deadline, params.chainId],
  )
  const digest = keccak256(encoded)
  const ownerSignature = await signer.signMessage(getBytes(digest))
  return { ownerSignature, deadline }
}

/**
 * Convenience wrapper for `PATCH /orders/{id}/signature` callers:
 * computes content_hash from the user_signature and signs the AttachSig
 * action. Returns both fields to ship to `api.attachSignature(...)`.
 */
export async function buildAttachSigOwnerSignature(
  signer: Signer,
  params: { orderId: string; userSignature: string; chainId: number; deadline?: number },
): Promise<OwnerSignatureResult> {
  return signOrderAction(signer, {
    action: 'AttachSig',
    orderId: params.orderId,
    contentHash: contentHashOf(params.userSignature),
    chainId: params.chainId,
    deadline: params.deadline,
  })
}

/** Right-pad an ASCII string to 32 bytes and return as 0x-prefixed hex. */
function bytes32FromAscii(s: string): string {
  const utf8 = toUtf8Bytes(s)
  if (utf8.length > 32) throw new Error(`bytes32 tag too long: ${s}`)
  const padded = new Uint8Array(32)
  padded.set(utf8, 0)
  return (
    '0x' +
    Array.from(padded, (b) => b.toString(16).padStart(2, '0')).join('')
  )
}
