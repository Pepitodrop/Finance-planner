import type { Account, Transaction } from "../../types";
import {
  isDetectedTransfer,
  presentedTransactionType,
} from "../../transactionClassification";

export type TransactionTypeFilter = "all" | "income" | "expense" | "transfer";
export type TransactionDateFilter = "all" | "month" | "30days";
export type TransactionAmountFilter = "all" | "small" | "medium" | "large";

export interface TransactionFilters {
  type: TransactionTypeFilter;
  query: string;
  category: string;
  account: string;
  amount: TransactionAmountFilter;
  date: TransactionDateFilter;
}

// "View all" from the dashboard and direct navigation to Transactions must
// show the user's recorded history by default. Users can still narrow the
// view to the current month or last 30 days explicitly.
export const DEFAULT_TRANSACTION_FILTERS: TransactionFilters = {
  type: "all",
  query: "",
  category: "all",
  account: "all",
  amount: "all",
  date: "all",
};

export interface TransactionCategorySummary {
  name: string;
  amountCents: number;
  percentage: number;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function filterTransactions(
  transactions: Transaction[],
  accounts: Account[],
  filters: TransactionFilters,
  referenceDate = new Date(),
) {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const query = filters.query.trim().toLocaleLowerCase();
  const cutoff = new Date(referenceDate);
  cutoff.setDate(referenceDate.getDate() - 30);
  return [...transactions]
    .sort((left, right) => right.date.localeCompare(left.date))
    .filter((transaction) => {
      const presentedType = presentedTransactionType(transaction);
      if (filters.type !== "all" && filters.type !== presentedType)
        return false;
      if (
        filters.category !== "all" &&
        transaction.category !== filters.category
      )
        return false;
      if (
        filters.account !== "all" &&
        transaction.accountId !== filters.account
      )
        return false;
      if (filters.amount === "small" && transaction.amountCents >= 5_000)
        return false;
      if (
        filters.amount === "medium" &&
        (transaction.amountCents < 5_000 || transaction.amountCents >= 50_000)
      )
        return false;
      if (filters.amount === "large" && transaction.amountCents < 50_000)
        return false;
      if (
        filters.date === "month" &&
        !transaction.date.startsWith(monthKey(referenceDate))
      )
        return false;
      if (filters.date === "30days" && new Date(transaction.date) < cutoff)
        return false;
      if (query) {
        const account = accountById.get(transaction.accountId);
        if (
          ![
            transaction.description,
            transaction.category,
            account?.name ?? "",
          ].some((value) => value.toLocaleLowerCase().includes(query))
        )
          return false;
      }
      return true;
    });
}

export function summarizeTransactions(transactions: Transaction[]) {
  const totals = transactions.reduce(
    (result, transaction) => {
      if (isDetectedTransfer(transaction)) return result;
      if (transaction.type === "income")
        result.incomeCents += transaction.amountCents;
      else result.expenseCents += transaction.amountCents;
      return result;
    },
    { incomeCents: 0, expenseCents: 0 },
  );
  return { ...totals, netCents: totals.incomeCents - totals.expenseCents };
}

export function summarizeExpenseCategories(
  transactions: Transaction[],
): TransactionCategorySummary[] {
  const amounts = new Map<string, number>();
  transactions.forEach((transaction) => {
    if (transaction.type !== "expense" || isDetectedTransfer(transaction))
      return;
    amounts.set(
      transaction.category,
      (amounts.get(transaction.category) ?? 0) + transaction.amountCents,
    );
  });
  const total = [...amounts.values()].reduce((sum, amount) => sum + amount, 0);
  return [...amounts]
    .map(([name, amountCents]) => ({
      name,
      amountCents,
      percentage: total > 0 ? Math.round((amountCents / total) * 100) : 0,
    }))
    .sort((left, right) => right.amountCents - left.amountCents);
}

export function transactionPeriodLabel(date: TransactionDateFilter) {
  if (date === "month") return "This month";
  if (date === "30days") return "Last 30 days";
  return "All time";
}