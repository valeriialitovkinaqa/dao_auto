/**
 * Parses a storefront money string into minor units (cents/öre):
 * "£10.05" → 1005, "€6,03" → 603, "100,50 kr" → 10050, "$1,234.50" → 123450, "£15" → 1500.
 */
export function parseMoney(text: string): number {
  const cleaned = text.replace(/[^\d.,]/g, '');
  const match = cleaned.match(/^(.*?)[.,](\d{2})$/);
  const whole = (match ? match[1] : cleaned).replace(/[.,]/g, '');
  const fraction = match ? match[2] : '00';
  if (!whole && !match) throw new Error(`Cannot parse money from "${text}"`);
  return Number(whole || '0') * 100 + Number(fraction);
}

/** Member price as the theme computes it: `price | times: 0.67 | round` (minor units). */
export const memberPriceOf = (price: number, rate: number): number => Math.round(price * rate);
