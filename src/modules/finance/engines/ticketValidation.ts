import type { FinancePurchaseRecord, FinancePurchaseValidation } from "../types/financeTypes";

function cents(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return sign === "-" ? -amount : amount;
}

function format(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function validateTicketArithmetic(purchase: FinancePurchaseRecord): FinancePurchaseValidation | null {
  const subtotal = cents(purchase.subtotalAmount);
  const discount = cents(purchase.discountAmount);
  const tax = cents(purchase.taxAmount);
  const total = cents(purchase.totalAmount);
  const lines = purchase.items.map((item) => cents(item.lineTotal));
  if (subtotal === null || discount === null || tax === null || total === null || lines.some((line) => line === null)) return null;
  const lineTotal = lines.reduce<bigint>((sum, line) => sum + (line ?? 0n), 0n);
  if (lineTotal !== subtotal) return { valid: false, calculatedTotal: format(lineTotal - discount + tax), discrepancy: format(total - (lineTotal - discount + tax)) };
  const exclusiveTaxTotal = subtotal - discount + tax;
  const includedTaxTotal = subtotal - discount;
  const calculated = exclusiveTaxTotal === total
    ? exclusiveTaxTotal
    : includedTaxTotal === total
      ? includedTaxTotal
      : exclusiveTaxTotal;
  return { valid: calculated === total, calculatedTotal: format(calculated), discrepancy: format(total - calculated) };
}
