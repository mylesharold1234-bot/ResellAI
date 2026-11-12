export const EBAY_FEE_SOURCE =
  "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822";
export const EBAY_FEE_CHECKED = "2026-10-18";
export function sneakerProceeds({
  price,
  buyerShipping,
  salesTax,
  sellerShipping,
  extras,
}: {
  price: number;
  buyerShipping: number;
  salesTax: number;
  sellerShipping: number;
  extras: number;
}) {
  const values = [price, buyerShipping, salesTax, sellerShipping, extras];
  if (values.some((v) => !Number.isFinite(v) || v < 0) || price <= 0)
    throw new Error("Enter a positive price and nonnegative costs.");
  const base = price + buyerShipping + salesTax;
  const rate = base >= 150 ? 0.08 : 0.136;
  const perOrder = base >= 150 ? 0 : base <= 10 ? 0.3 : 0.4;
  const fee = Math.round((base * rate + perOrder + Number.EPSILON) * 100) / 100;
  const proceeds =
    Math.round(
      (price + buyerShipping - fee - sellerShipping - extras + Number.EPSILON) *
        100,
    ) / 100;
  return { fee, proceeds, rate, perOrder, base };
}
