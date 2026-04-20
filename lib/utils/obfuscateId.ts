/**
 * Deterministic, reversible UUID obfuscation for use in public URLs.
 *
 * A UUID (128-bit random) is encoded as a 22-character base62 string.
 * The encoding is computed from the UUID value alone — no lookup table,
 * no server round-trip, no session state.  The app decodes it on the way
 * in before passing the real ID to any API call.
 *
 *   77bfabb2-e725-4d68-af0a-e5f421eb2895
 *   → "3ij5e0bRx6qGsMvYdFp8kW"   (22 chars, opaque to casual observers)
 *
 * Implementation uses four 32-bit unsigned integer "limbs" so all
 * intermediate values stay within Number.MAX_SAFE_INTEGER — no BigInt needed.
 */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
// ceil(128 × log₂ / log₆₂) = 22
const SLUG_LENGTH = 22;
// 2^32 used as the limb modulus
const M32 = 0x100000000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[0-9a-zA-Z]{22}$/;

type U128 = [number, number, number, number]; // big-endian 32-bit limbs

/**
 * Divide a 128-bit value (4 big-endian 32-bit limbs) by `d`.
 * Mutates the array in place. Returns the remainder.
 * All intermediate values ≤ 61 × 2³² + (2³²−1) ≈ 2.66 × 10¹¹ < MAX_SAFE_INTEGER.
 */
function divMod128(limbs: U128, d: number): number {
  let rem = 0;
  for (let i = 0; i < 4; i++) {
    const cur = rem * M32 + limbs[i];
    const q = Math.floor(cur / d);
    rem = cur - q * d;
    limbs[i] = q;
  }
  return rem;
}

function isZero128(limbs: U128): boolean {
  return (limbs[0] | limbs[1] | limbs[2] | limbs[3]) === 0;
}

/**
 * Multiply a 128-bit value by `factor` and add `addend`.
 * Overflow beyond 128 bits is silently discarded (modular arithmetic).
 * Max intermediate: (2³²−1) × 62 + 61 ≈ 2.66 × 10¹¹ < MAX_SAFE_INTEGER.
 */
function mulAdd128(limbs: U128, factor: number, addend: number): void {
  let carry = addend;
  for (let i = 3; i >= 0; i--) {
    const v = limbs[i] * factor + carry;
    limbs[i] = v % M32;
    carry = Math.floor(v / M32);
  }
  // Bits above 128 are discarded — only reachable with invalid slugs.
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** UUID → 22-char opaque slug. */
export function encodeId(uuid: string): string {
  if (!UUID_RE.test(uuid)) return uuid;

  const h = uuid.replace(/-/g, "");
  const limbs: U128 = [
    parseInt(h.slice(0, 8), 16),
    parseInt(h.slice(8, 16), 16),
    parseInt(h.slice(16, 24), 16),
    parseInt(h.slice(24, 32), 16),
  ];

  const chars: string[] = [];
  while (!isZero128(limbs)) {
    chars.unshift(ALPHABET[divMod128(limbs, 62)]);
  }
  return chars.join("").padStart(SLUG_LENGTH, "0");
}

/** 22-char opaque slug → UUID. Returns the input unchanged if decoding fails. */
export function decodeId(slug: string): string {
  // Already a plain UUID — pass through (backward-compat safety net).
  if (UUID_RE.test(slug)) return slug;
  if (!SLUG_RE.test(slug)) return slug;

  const limbs: U128 = [0, 0, 0, 0];
  for (const char of slug) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) return slug;
    mulAdd128(limbs, 62, idx);
  }

  const h = limbs.map((l) => l.toString(16).padStart(8, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}


