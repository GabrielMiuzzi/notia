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
/** `exchange` is a currency exchange with savings: neither income nor expense. */
export type FinanceTransactionType =
  "income" | "expense" | "transfer" | "adjustment" | "exchange";
/** `card_unpaid` is a card expense that no loaded statement includes yet. */
export type FinanceTransactionStatus =
  "pending" | "confirmed" | "corrected" | "discarded" | "card_unpaid";

export interface FinanceAccount {
  id: string;
  name: string;
  accountType: string;
  currency: FinanceCurrency;
  active: boolean;
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
  /** Day the movement counts; for a card expense, the day its statement is due. */
  effectiveDate: string;
  /** Day of the purchase when it is not the day it counts. */
  purchaseDate?: string | null;
  accountId: string;
  destinationAccountId?: string | null;
  categoryId?: string | null;
  description: string;
  source: string;
  status: FinanceTransactionStatus;
  actorUserId?: number | null;
  /** Stable library_users identity. actorUserId is legacy Telegram audit data. */
  actorLibraryUserId?: string | null;
  sourceArtifactId?: string | null;
  serviceId?: string | null;
  merchantId?: string | null;
  operationFingerprint?: string | null;
  installmentId?: string | null;
  sourceReference?: string | null;
  rawSource?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface FinancePurchaseSummary {
  id: string;
  accountId: string | null;
  transactionId: string | null;
  serviceId?: string | null;
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

export interface FinanceProductPrice {
  merchantId?: string | null;
  merchantName?: string | null;
  observedAt: string;
  currency: FinanceCurrency;
  quantity: string;
  unitPrice: string;
  finalAmount: string;
}

/** A product with the last price paid at each merchant. */
export interface FinanceProductSummary {
  id: string;
  name: string;
  observationCount: number;
  lastObservedAt?: string | null;
  prices: FinanceProductPrice[];
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
  status: Exclude<FinanceTransactionStatus, "discarded" | "card_unpaid">;
  signedDocument?: boolean;
  /** Native SQLite timestamp; it is returned by reads and never supplied by callers. */
  readonly createdAt?: string | null;
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
  categoryId?: string | null;
}

/** A loaded statement is a paid one: its total is what was paid for the card. */
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
  status: Exclude<FinanceTransactionStatus, "discarded" | "card_unpaid">;
  /** Native SQLite timestamp; it is returned by reads and never supplied by callers. */
  readonly createdAt?: string | null;
  sourceReference?: string | null;
  rawExtraction?: string | null;
  items: FinanceCreditCardStatementItem[];
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

/** A plan with its pending installments, next due date and remaining total. */
export interface FinanceInstallmentPlanSummary extends FinanceInstallmentPlan {
  pendingCount: number;
  nextDueDate?: string | null;
  remainingAmount: string;
}

export interface FinanceDebtRatioHistoryPoint {
  period: string;
  debtByCurrency: Record<string, string>;
  servicesByCurrency: Record<string, string>;
  salaryByCurrency: Record<string, string>;
}

export interface FinanceDashboard {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  transactions: FinanceTransaction[];
  transactionsTruncated: boolean;
  incomeTotal: string;
  expenseTotal: string;
  netTotal: string;
  incomeByCurrency: Record<string, string>;
  expenseByCurrency: Record<string, string>;
  netByCurrency: Record<string, string>;
  /** Card statements due in the month: what was paid for the cards. */
  debtByCurrency: Record<string, string>;
  /** Services paid in the month. */
  servicesByCurrency: Record<string, string>;
  /** Net salary of the previous period, the one that pays the month. */
  salaryByCurrency: Record<string, string>;
  debtRatioHistory: FinanceDebtRatioHistoryPoint[];
  savings: FinanceSavingsReserve[];
  savingsMovements: FinanceSavingsMovement[];
  savingsMovementsTruncated: boolean;
  merchants: FinanceMerchant[];
}

export type FinanceServiceOccurrenceStatus =
  | "pending" | "current" | "accepted" | "rejected" | "discarded" | "failed" | "outdated";

export interface FinanceServiceOccurrence {
  id: string;
  serviceId: string;
  period: string;
  expectedAmount: string;
  paidAmount?: string | null;
  effectiveDate?: string | null;
  status: FinanceServiceOccurrenceStatus;
  transactionId?: string | null;
  artifactId?: string | null;
  sourceReference?: string | null;
  rawSource?: string | null;
  actorLibraryUserId?: string | null;
  source: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Paid minus expected, computed by the backend when the occurrence was paid. */
  difference?: string | null;
}

export interface FinanceServiceOccurrenceVersion extends FinanceServiceOccurrence {
  occurrenceId: string;
  versionNumber: number;
  reason?: string | null;
}

/** An active service in a month, as the backend classifies it. */
export interface FinanceServiceMonthStatus {
  serviceId: string;
  name: string;
  provider?: string | null;
  currency: FinanceCurrency;
  expectedAmount: string;
  paidAmount?: string | null;
  dueDay?: number | null;
  status: "paid" | "pending" | "not-applicable";
  occurrenceId?: string | null;
}

/** A doubt left by an automatic link; the assistant asks it in the chat. */
export interface FinanceReviewItem {
  id: string;
  kind: string;
  status: "pending" | "resolved" | "dismissed";
  question: string;
  options: Array<{ id: string; label: string }>;
  resolution?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
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
  actorLibraryUserId?: string | null;
  linkedTransactionId?: string | null;
}

export interface FinanceContext {
  libraryPath: string;
  androidDirectoryUri?: string;
  actorLibraryUserId: string;
  source: 'app' | 'public-url' | 'telegram';
}

export function financeContext(
  library: NotiaLibrary,
  actorLibraryUserId = 'user-owner',
  source: FinanceContext['source'] = 'app',
): FinanceContext {
  return {
    libraryPath: library.path,
    androidDirectoryUri: library.androidTreeUri,
    actorLibraryUserId,
    source,
  };
}
