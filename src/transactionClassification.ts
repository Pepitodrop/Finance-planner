import type { Transaction } from "./types";

/** Presentation-only inference until transfers become a first-class domain type. */
export function isDetectedTransfer(transaction: Transaction): boolean {
  return /transfer|umbuch|übertrag/i.test(
    `${transaction.category} ${transaction.description}`,
  );
}

export type PresentedTransactionType = "income" | "expense" | "transfer";

export function presentedTransactionType(
  transaction: Transaction,
): PresentedTransactionType {
  if (isDetectedTransfer(transaction)) return "transfer";
  return transaction.type;
}
