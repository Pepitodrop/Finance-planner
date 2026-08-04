import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Ref } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Filter,
  Pencil,
  Plus,
  Search,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney } from "../../finance";
import { presentedTransactionType } from "../../transactionClassification";
import type { Account, Transaction } from "../../types";
import {
  DEFAULT_TRANSACTION_FILTERS,
  filterTransactions,
  summarizeExpenseCategories,
  summarizeTransactions,
  transactionPeriodLabel,
  type TransactionFilters,
  type TransactionTypeFilter,
} from "./transactionsModel";

interface TransactionsPageProps {
  transactions: Transaction[];
  accounts: Account[];
  onAdd: () => void;
  onEdit: (transaction: Transaction) => void;
  onDelete: (transactionId: string) => void;
  referenceDate?: Date;
}

const PAGE_SIZE = 10;
const CATEGORY_COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#22b8cf",
  "#d946ef",
  "#f59e0b",
  "#64748b",
];
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function signedMoney(transaction: Transaction) {
  const type = presentedTransactionType(transaction);
  return `${type === "income" ? "+" : "−"}${formatMoney(transaction.amountCents)}`;
}

function typeLabel(transaction: Transaction) {
  const type = presentedTransactionType(transaction);
  return type === "income"
    ? "Income"
    : type === "transfer"
      ? "Transfer"
      : "Expense";
}

function TransactionIcon({ transaction }: { transaction: Transaction }) {
  const type = presentedTransactionType(transaction);
  return (
    <span
      className={`transactions-icon transactions-icon--${type}`}
      aria-hidden="true"
    >
      {type === "income" ? (
        <ArrowUpRight />
      ) : type === "transfer" ? (
        <ArrowLeftRight />
      ) : (
        <ArrowDownRight />
      )}
    </span>
  );
}

interface FilterFieldsProps {
  filters: TransactionFilters;
  setFilters: (filters: TransactionFilters) => void;
  accounts: Account[];
  categories: string[];
  firstRef?: Ref<HTMLSelectElement>;
}

function FilterFields({
  filters,
  setFilters,
  accounts,
  categories,
  firstRef,
}: FilterFieldsProps) {
  const update = <K extends keyof TransactionFilters>(
    key: K,
    value: TransactionFilters[K],
  ) => setFilters({ ...filters, [key]: value });
  return (
    <div className="transactions-filter-fields">
      <label>
        Date scope
        <select
          ref={firstRef}
          value={filters.date}
          onChange={(event) =>
            update("date", event.target.value as TransactionFilters["date"])
          }
        >
          <option value="month">This month</option>
          <option value="30days">Last 30 days</option>
          <option value="all">All time</option>
        </select>
      </label>
      <label>
        Category
        <select
          value={filters.category}
          onChange={(event) => update("category", event.target.value)}
        >
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category}>{category}</option>
          ))}
        </select>
      </label>
      <label>
        Account
        <select
          value={filters.account}
          onChange={(event) => update("account", event.target.value)}
        >
          <option value="all">All accounts</option>
          {accounts.map((account) => (
            <option value={account.id} key={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Amount
        <select
          value={filters.amount}
          onChange={(event) =>
            update("amount", event.target.value as TransactionFilters["amount"])
          }
        >
          <option value="all">All amounts</option>
          <option value="small">Under €50</option>
          <option value="medium">€50–€500</option>
          <option value="large">€500 and above</option>
        </select>
      </label>
    </div>
  );
}

export function TransactionsPage({
  transactions,
  accounts,
  onAdd,
  onEdit,
  onDelete,
  referenceDate = new Date(),
}: TransactionsPageProps) {
  const [filters, setFilters] = useState<TransactionFilters>(
    DEFAULT_TRANSACTION_FILTERS,
  );
  const [draftFilters, setDraftFilters] = useState<TransactionFilters>(
    DEFAULT_TRANSACTION_FILTERS,
  );
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterSheetRef = useRef<HTMLElement>(null);
  const firstMobileFilterRef = useRef<HTMLSelectElement>(null);
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const categories = useMemo(
    () =>
      [
        ...new Set(transactions.map((transaction) => transaction.category)),
      ].sort(),
    [transactions],
  );
  const filtered = useMemo(
    () => filterTransactions(transactions, accounts, filters, referenceDate),
    [accounts, filters, referenceDate, transactions],
  );
  const totals = useMemo(() => summarizeTransactions(filtered), [filtered]);
  const categorySummary = useMemo(
    () => summarizeExpenseCategories(filtered),
    [filtered],
  );
  const categoryTotal = categorySummary.reduce(
    (sum, category) => sum + category.amountCents,
    0,
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageTransactions = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const firstShown = filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastShown = Math.min(page * PAGE_SIZE, filtered.length);
  const visiblePages = Array.from(
    { length: Math.min(5, pageCount) },
    (_, index) =>
      Math.min(Math.max(1, page - 2), Math.max(1, pageCount - 4)) + index,
  ).filter((value) => value <= pageCount);
  const scopeLabel = transactionPeriodLabel(filters.date);

  useEffect(() => setPage(1), [filters]);
  useEffect(
    () => setPage((current) => Math.min(current, pageCount)),
    [pageCount],
  );
  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const frame = document.querySelector<HTMLElement>(".app-shell__frame");
    const navigation = document.querySelector<HTMLElement>(
      ".app-mobile-navigation",
    );
    const trigger = filterTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    frame?.setAttribute("inert", "");
    navigation?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => firstMobileFilterRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileFiltersOpen(false);
        return;
      }
      if (event.key !== "Tab" || !filterSheetRef.current) return;
      const focusable = [
        ...filterSheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter((item) => item.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      frame?.removeAttribute("inert");
      navigation?.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => trigger?.focus());
    };
  }, [mobileFiltersOpen]);

  const setType = (type: TransactionTypeFilter) =>
    setFilters((current) => ({ ...current, type }));
  const openMobileFilters = () => {
    setDraftFilters(filters);
    setMobileFiltersOpen(true);
  };
  const resetAll = () => setFilters(DEFAULT_TRANSACTION_FILTERS);
  const closeMobileFilters = () => setMobileFiltersOpen(false);
  const applyMobileFilters = () => {
    setFilters(draftFilters);
    setMobileFiltersOpen(false);
  };

  const emptyMessage =
    transactions.length === 0
      ? "No transactions yet. Add your first transaction to begin."
      : "No transactions match your search and filters.";

  return (
    <section
      className="transactions-feature"
      lang="en"
      data-transactions-ready="true"
      aria-labelledby="transactions-title"
    >
      <header className="transactions-page-header">
        <div>
          <h1 id="transactions-title">Transactions</h1>
          <p>Search, review and manage your recorded activity.</p>
        </div>
        <button
          type="button"
          className="primary transactions-add"
          onClick={onAdd}
        >
          <Plus aria-hidden="true" /> Add transaction
        </button>
      </header>

      <div className="transactions-controls">
        <label className="transactions-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search transactions</span>
          <input
            type="search"
            value={filters.query}
            onChange={(event) =>
              setFilters({ ...filters, query: event.target.value })
            }
            placeholder="Search transactions"
          />
        </label>
        <button
          ref={filterTriggerRef}
          type="button"
          className="transactions-filter-trigger transactions-filter-trigger--mobile"
          aria-haspopup="dialog"
          aria-expanded={mobileFiltersOpen}
          onClick={openMobileFilters}
        >
          <Filter aria-hidden="true" /> Filters
        </button>
        <button
          type="button"
          className="transactions-filter-trigger transactions-filter-trigger--desktop"
          aria-expanded={filtersOpen}
          aria-controls="transactions-desktop-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <Filter aria-hidden="true" /> Filters
        </button>
      </div>

      <section
        className="transactions-summary"
        aria-labelledby="transactions-summary-title"
      >
        <div className="transactions-summary__header">
          <h2 id="transactions-summary-title">Summary</h2>
          <span>{scopeLabel}</span>
        </div>
        <dl>
          <div>
            <dt>Income</dt>
            <dd className="money-positive">
              +{formatMoney(totals.incomeCents)}
            </dd>
          </div>
          <div>
            <dt>Expenses</dt>
            <dd className="money-negative">
              −{formatMoney(totals.expenseCents)}
            </dd>
          </div>
          <div>
            <dt>Net</dt>
            <dd
              className={
                totals.netCents >= 0 ? "money-positive" : "money-negative"
              }
            >
              {totals.netCents >= 0 ? "+" : "−"}
              {formatMoney(Math.abs(totals.netCents))}
            </dd>
          </div>
        </dl>
      </section>

      <div
        className="transaction-tabs"
        role="group"
        aria-label="Transaction type"
      >
        {(
          [
            ["all", "All"],
            ["income", "Income"],
            ["expense", "Expenses"],
            ["transfer", "Transfers"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={filters.type === value}
            className={filters.type === value ? "active" : ""}
            onClick={() => setType(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {filters.type === "transfer" && (
        <p className="transactions-inference-note">
          Transfers are inferred from transaction descriptions and categories;
          stored transaction types are unchanged.
        </p>
      )}

      <div className="transactions-layout">
        <section
          className="transactions-list-panel"
          aria-labelledby="transactions-list-title"
        >
          <div className="transactions-list-heading">
            <h2 id="transactions-list-title">Activity</h2>
            <span>
              {filtered.length}{" "}
              {filtered.length === 1 ? "transaction" : "transactions"}
            </span>
          </div>
          <div className="transactions-desktop-table">
            <table>
              <caption className="sr-only">Filtered transactions</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Account</th>
                  <th className="align-right">Amount</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageTransactions.map((transaction) => {
                  const account = accountById.get(transaction.accountId);
                  const type = presentedTransactionType(transaction);
                  return (
                    <tr key={transaction.id}>
                      <td>
                        <time dateTime={transaction.date}>
                          {new Intl.DateTimeFormat("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          }).format(new Date(`${transaction.date}T12:00:00`))}
                        </time>
                      </td>
                      <td>
                        <div className="transactions-description">
                          <TransactionIcon transaction={transaction} />
                          <span>
                            <strong>{transaction.description}</strong>
                            <small>
                              {transaction.recurring
                                ? "Recurring payment"
                                : typeLabel(transaction)}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="transactions-category">
                          {type === "transfer"
                            ? "Transfer"
                            : transaction.category}
                        </span>
                      </td>
                      <td>
                        <div className="transactions-account">
                          <WalletCards aria-hidden="true" />
                          <span>
                            <strong>
                              {account?.name ?? "Unknown account"}
                            </strong>
                            <small>
                              {account?.type ?? "Account unavailable"}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td
                        className={`transactions-amount transactions-amount--${type}`}
                      >
                        <span className="sr-only">
                          {typeLabel(transaction)}:{" "}
                        </span>
                        {signedMoney(transaction)}
                      </td>
                      <td>
                        <div className="transactions-row-actions">
                          <button
                            type="button"
                            onClick={() => onEdit(transaction)}
                            aria-label={`Edit ${transaction.description}`}
                          >
                            <Pencil />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(transaction.id)}
                            aria-label={`Delete ${transaction.description}`}
                          >
                            <Trash2 />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul
            className="transactions-mobile-list"
            aria-label="Filtered transactions"
          >
            {pageTransactions.map((transaction) => {
              const account = accountById.get(transaction.accountId);
              const type = presentedTransactionType(transaction);
              return (
                <li key={transaction.id}>
                  <TransactionIcon transaction={transaction} />
                  <div className="transactions-mobile-copy">
                    <time dateTime={transaction.date}>
                      {new Intl.DateTimeFormat("en-GB", {
                        day: "numeric",
                        month: "short",
                      }).format(new Date(`${transaction.date}T12:00:00`))}
                    </time>
                    <strong>{transaction.description}</strong>
                    <span>
                      {type === "transfer" ? "Transfer" : transaction.category}{" "}
                      · {account?.name ?? "Unknown account"}
                    </span>
                  </div>
                  <span
                    className={`transactions-amount transactions-amount--${type}`}
                  >
                    <span className="sr-only">{typeLabel(transaction)}: </span>
                    {signedMoney(transaction)}
                  </span>
                  <div className="transactions-row-actions">
                    <button
                      type="button"
                      onClick={() => onEdit(transaction)}
                      aria-label={`Edit ${transaction.description}`}
                    >
                      <Pencil />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(transaction.id)}
                      aria-label={`Delete ${transaction.description}`}
                    >
                      <Trash2 />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {pageTransactions.length === 0 && (
            <div className="transactions-empty">
              <strong>
                {transactions.length === 0
                  ? "No transactions yet"
                  : "No matching transactions"}
              </strong>
              <p>{emptyMessage}</p>
              {transactions.length === 0 ? (
                <button type="button" onClick={onAdd}>
                  Add transaction
                </button>
              ) : (
                <button type="button" onClick={resetAll}>
                  Reset filters
                </button>
              )}
            </div>
          )}
          <footer className="transactions-pagination">
            <span>
              Items {firstShown}–{lastShown} of {filtered.length}
            </span>
            <div aria-label="Pagination">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft />
              </button>
              {visiblePages.map((number) => (
                <button
                  type="button"
                  key={number}
                  aria-label={`Page ${number}`}
                  aria-current={page === number ? "page" : undefined}
                  className={page === number ? "active" : ""}
                  onClick={() => setPage(number)}
                >
                  {number}
                </button>
              ))}
              <button
                type="button"
                aria-label="Next page"
                disabled={page === pageCount}
                onClick={() =>
                  setPage((current) => Math.min(pageCount, current + 1))
                }
              >
                <ChevronRight />
              </button>
            </div>
          </footer>
        </section>

        <aside
          className="transactions-sidebar"
          aria-label="Transaction insights and filters"
        >
          <section
            className="transactions-category-panel"
            aria-labelledby="category-summary-title"
          >
            <div className="transactions-panel-heading">
              <div>
                <h2 id="category-summary-title">Expenses by category</h2>
                <span>{scopeLabel}</span>
              </div>
            </div>
            {categorySummary.length ? (
              <>
                <div className="transactions-category-chart" aria-hidden="true">
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart>
                      <Pie
                        data={categorySummary}
                        dataKey="amountCents"
                        nameKey="name"
                        innerRadius={49}
                        outerRadius={75}
                      >
                        {categorySummary.map((category, index) => (
                          <Cell
                            key={category.name}
                            fill={
                              CATEGORY_COLORS[index % CATEGORY_COLORS.length]
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => formatMoney(Number(value))}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <strong>{formatMoney(categoryTotal)}</strong>
                </div>
                <ul className="transactions-category-list">
                  {categorySummary.map((category, index) => (
                    <li key={category.name}>
                      <i
                        style={
                          {
                            "--category-color":
                              CATEGORY_COLORS[index % CATEGORY_COLORS.length],
                          } as CSSProperties
                        }
                      />
                      <span>{category.name}</span>
                      <span>{category.percentage}%</span>
                      <strong>{formatMoney(category.amountCents)}</strong>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="transactions-category-empty">
                <strong>No matching expenses</strong>
                <span>
                  Categories appear when the selected scope contains expenses.
                </span>
              </div>
            )}
          </section>
          {filtersOpen && (
            <section
              id="transactions-desktop-filters"
              className="transactions-filter-panel"
              aria-labelledby="desktop-filters-title"
            >
              <div className="transactions-panel-heading">
                <h2 id="desktop-filters-title">Filters</h2>
                <button type="button" onClick={resetAll}>
                  Reset
                </button>
              </div>
              <FilterFields
                filters={filters}
                setFilters={setFilters}
                accounts={accounts}
                categories={categories}
              />
            </section>
          )}
        </aside>
      </div>

      {mobileFiltersOpen && createPortal(
        <div
          className="transactions-filter-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMobileFilters();
          }}
        >
          <section
            ref={filterSheetRef}
            className="transactions-filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-filters-title"
          >
            <header>
              <div>
                <span>Refine activity</span>
                <h2 id="mobile-filters-title">Filters</h2>
              </div>
              <button
                type="button"
                aria-label="Close filters"
                onClick={closeMobileFilters}
              >
                <X />
              </button>
            </header>
            <FilterFields
              filters={draftFilters}
              setFilters={setDraftFilters}
              accounts={accounts}
              categories={categories}
              firstRef={firstMobileFilterRef}
            />
            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => setDraftFilters(DEFAULT_TRANSACTION_FILTERS)}
              >
                Reset
              </button>
              <button
                type="button"
                className="secondary"
                onClick={closeMobileFilters}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={applyMobileFilters}
              >
                Apply filters
              </button>
            </footer>
          </section>
        </div>, document.body
      )}
    </section>
  );
}
