export function calculateProfit(sale: number, purchase: number, shipping: number, feePercent: number, extras: number) {
  if ([sale, purchase, shipping, feePercent, extras].some(v => !Number.isFinite(v) || v < 0) || feePercent > 100) throw new Error('Enter nonnegative amounts and a fee from 0 to 100.');
  const fees = sale * feePercent / 100;
  const costs = purchase + shipping + extras;
  const proceeds = sale - fees - shipping - extras;
  const profit = proceeds - purchase;
  return { fees, costs: costs + fees, proceeds, profit, roi: costs > 0 ? profit / costs * 100 : null };
}
