>>SOURCE FORMAT FREE
IDENTIFICATION DIVISION.
PROGRAM-ID. FINANCE-TEST-SEED.

PROCEDURE DIVISION.
MAIN.
    *> Deterministic fixture generation only. PostgreSQL access, encryption,
    *> user lookup and authorization remain in Node.js. This program is never
    *> invoked by normal application startup.
    DISPLAY '{'
    DISPLAY '  "state": {'
    DISPLAY '    "accounts": ['
    DISPLAY '      {"id":"seed-checking","name":"Finance Planner Test Girokonto","type":"checking","balanceCents":695950,"currency":"EUR"}'
    DISPLAY '    ],'
    DISPLAY '    "transactions": ['
    DISPLAY '      {"id":"seed-salary-20260801","accountId":"seed-checking","description":"Test Salary","category":"Income","type":"income","amountCents":250000,"date":"2026-08-01"},'
    DISPLAY '      {"id":"seed-rewe-20260803","accountId":"seed-checking","description":"REWE","category":"Groceries","type":"expense","amountCents":9000,"date":"2026-08-03"},'
    DISPLAY '      {"id":"seed-internet-20260805","accountId":"seed-checking","description":"Internet","category":"Utilities","type":"expense","amountCents":4999,"date":"2026-08-05"},'
    DISPLAY '      {"id":"seed-restaurant-20260808","accountId":"seed-checking","description":"Restaurant","category":"Dining","type":"expense","amountCents":12000,"date":"2026-08-08"},'
    DISPLAY '      {"id":"seed-refund-20260810","accountId":"seed-checking","description":"Test Refund","category":"Refund","type":"income","amountCents":5000,"date":"2026-08-10"}'
    DISPLAY '    ],'
    DISPLAY '    "goals": []'
    DISPLAY '  },'
    DISPLAY '  "secureData": {'
    DISPLAY '    "testSeed": {"generator":"gnucobol","version":1}'
    DISPLAY '  }'
    DISPLAY '}'
    STOP RUN.
