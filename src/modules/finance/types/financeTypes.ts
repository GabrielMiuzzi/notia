import type { NotiaLibrary } from "../../../types/notia";

export type FinanceCurrency = "ARS" | "USD";

export interface FinanceDevTable {
  name: string;
}

export interface FinanceDevQueryResult {
  columns: string[];
  rows: Array<Array<string | null>>;
  totalRows: number;
  page: number;
  pageSize: number;
}
export type FinanceTransactionType =
  "income" | "expense" | "transfer" | "adjustment";
export type FinanceTransactionStatus =
  "pending" | "confirmed" | "corrected" | "discarded";

export interface FinanceAccount {
  id: string;
  name: string;
  accountType: string;
  currency: FinanceCurrency;
  openingBalance: string;
  active: boolean;
  currentBalance: string;
}

export interface FinanceCategory {
  id: string;
  name: string;
  kind: "income" | "expense";
  active: boolean;
  parentId?: string | null;
  description?: string | null;
}

export interface FinanceTransaction {
  id: string;
  transactionType: FinanceTransactionType;
  amount: string;
  currency: FinanceCurrency;
  effectiveDate: string;
  accountId: string;
  destinationAccountId?: string | null;
  categoryId?: string | null;
  description: string;
  source: string;
  status: FinanceTransactionStatus;
  actorUserId?: number | null;
  sourceArtifactId?: string | null;
  merchantId?: string | null;
  operationFingerprint?: string | null;
  installmentId?: string | null;
  sourceReference?: string | null;
  rawSource?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface FinancePurchaseItem {
  id: string;
  originalDescription: string;
  normalizedDescription?: string | null;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  lineTotal: string;
  categoryId?: string | null;
}

export interface FinancePurchaseRecord {
  id: string;
  accountId: string;
  merchantName: string;
  observedAt: string;
  currency: FinanceCurrency;
  subtotalAmount: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  status: Exclude<FinanceTransactionStatus, "discarded">;
  sourceReference?: string | null;
  rawExtraction?: string | null;
  contentHash?: string | null;
  items: FinancePurchaseItem[];
}

export interface FinancePurchaseValidation {
  valid: boolean;
  calculatedTotal: string;
  discrepancy: string;
}

export interface FinanceSavedPurchase {
  purchase: FinancePurchaseRecord;
  validation: FinancePurchaseValidation;
}

export interface FinanceExtractionResult {
  artifactId: string;
  extractor: string;
  status: string;
  rawResult: unknown;
}

export interface FinancePurchaseSummary {
  id: string;
  merchantName: string;
  observedAt: string;
  currency: FinanceCurrency;
  totalAmount: string;
  status: FinanceTransactionStatus;
  itemCount: number;
}

export interface FinancePriceObservation {
  id: string;
  productId: string;
  productName: string;
  merchantName?: string | null;
  observedAt: string;
  currency: FinanceCurrency;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  finalAmount: string;
  status: FinanceTransactionStatus;
}

export interface FinanceSalaryConcept {
  id: string;
  name: string;
  conceptType: "earning" | "deduction";
  amount: string;
}

export interface FinanceSalaryReceipt {
  id: string;
  period: string;
  paymentDate: string;
  employer: string;
  grossAmount: string;
  deductionsTotal: string;
  netAmount: string;
  currency: FinanceCurrency;
  accountId: string;
  status: Exclude<FinanceTransactionStatus, "discarded">;
  sourceReference?: string | null;
  rawExtraction?: string | null;
  concepts: FinanceSalaryConcept[];
}

export interface FinanceSalaryEvolution {
  salary: FinanceSalaryReceipt;
  grossChange: string;
  netChange: string;
  deductionsChange: string;
  netChangePercent?: string | null;
}

export type FinanceCreditCardStatementItemType =
  | "purchase"
  | "fee"
  | "interest"
  | "tax"
  | "payment"
  | "credit";

export interface FinanceCreditCardStatementItem {
  id: string;
  purchaseDate: string;
  description: string;
  amount: string;
  currency: FinanceCurrency;
  itemType: FinanceCreditCardStatementItemType;
  installmentNumber?: number | null;
  installmentCount?: number | null;
  transactionId?: string | null;
}

export interface FinanceCreditCardStatement {
  id: string;
  accountId: string;
  issuer: string;
  cardLastFour?: string | null;
  period: string;
  closingDate: string;
  dueDate: string;
  currency: FinanceCurrency;
  previousBalance: string;
  paymentsAmount: string;
  creditsAmount: string;
  purchasesAmount: string;
  feesAmount: string;
  interestAmount: string;
  taxesAmount: string;
  totalDue: string;
  minimumPayment?: string | null;
  status: Exclude<FinanceTransactionStatus, "discarded">;
  sourceReference?: string | null;
  rawExtraction?: string | null;
  items: FinanceCreditCardStatementItem[];
}

export interface FinanceSavedCreditCardStatement {
  statement: FinanceCreditCardStatement;
  matchedExistingTransactions: number;
  createdTransactions: number;
}

export interface FinanceInstallmentPlan {
  id: string;
  accountId: string;
  merchantName: string;
  description: string;
  purchaseDate: string;
  currency: FinanceCurrency;
  totalAmount: string;
  installmentCount: number;
}

export interface FinanceInstallment {
  id: string;
  planId: string;
  installmentNumber: number;
  dueDate: string;
  amount: string;
  status: FinanceTransactionStatus;
}

export interface FinanceInvestment {
  id: string;
  accountId?: string | null;
  name: string;
  assetType: "asset" | "debt" | "cash" | "security";
  currency: FinanceCurrency;
  active: boolean;
  valuationDate: string;
  valuationAmount: string;
}

export interface FinanceNetWorth {
  asOf: string;
  byCurrency: Record<FinanceCurrency, string | undefined>;
}

export type FinanceNetWorthHistoryPoint = FinanceNetWorth;

export interface FinanceDashboard {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  transactions: FinanceTransaction[];
  incomeTotal: string;
  expenseTotal: string;
  netTotal: string;
  incomeByCurrency: Record<string, string>;
  expenseByCurrency: Record<string, string>;
  netByCurrency: Record<string, string>;
  savings: FinanceSavingsReserve[];
  savingsMovements: FinanceSavingsMovement[];
  merchants: FinanceMerchant[];
  balanceHistory: Array<{ month: string; byCurrency: Record<string, string> }>;
}

export interface FinanceMerchant {
  id: string;
  name: string;
}

export type FinanceSavingsMovementType =
  "contribution" | "withdrawal" | "return" | "loss" | "adjustment";

export interface FinanceSavingsReserve {
  id: string;
  name: string;
  currency: FinanceCurrency;
  openingBalance: string;
  objective?: string | null;
  active: boolean;
  balance: string;
}

export interface FinanceSavingsMovement {
  id: string;
  reserveId: string;
  accountId?: string | null;
  movementType: FinanceSavingsMovementType;
  amount: string;
  currency: FinanceCurrency;
  effectiveDate: string;
  description: string;
  reason?: string | null;
  source: string;
  status: FinanceTransactionStatus;
  actorUserId?: number | null;
  linkedTransactionId?: string | null;
}

export interface FinanceContext {
  libraryPath: string;
  androidDirectoryUri?: string;
}

export function financeContext(library: NotiaLibrary): FinanceContext {
  return {
    libraryPath: library.path,
    androidDirectoryUri: library.androidTreeUri,
  };
}
