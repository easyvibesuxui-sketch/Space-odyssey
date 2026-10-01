// Promo codes. Matching ignores spaces and letter case.
export const PROMO_CODES = {
  1010: { id: '1010', coins: 10_000_000, label: '10,000,000 coins unlocked' },
};

export function findPromo(input) {
  const code = String(input ?? '').replace(/\s+/g, '').toUpperCase();
  return PROMO_CODES[code] ?? null;
}
