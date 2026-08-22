       IDENTIFICATION DIVISION.
       PROGRAM-ID. TEST-DATA-SEED.

       PROCEDURE DIVISION.
       MAIN.
           DISPLAY "FP-SEED|1"
           DISPLAY "ACCOUNT|seed-checking|Test Girokonto|checking|500000|EUR"
           DISPLAY "ACCOUNT|seed-savings|Test Savings|savings|250000|EUR"
           DISPLAY "TRANSACTION|seed-tx-001|seed-checking|Salary|Income|income"
           DISPLAY "|250000|2026-08-01|true" WITH NO ADVANCING
           DISPLAY ""
           DISPLAY "TRANSACTION|seed-tx-002|seed-checking|Groceries|Food|expense"
           DISPLAY "|9000|2026-08-03|false" WITH NO ADVANCING
           DISPLAY ""
           DISPLAY "TRANSACTION|seed-tx-003|seed-checking|Internet|Services|expense"
           DISPLAY "|4999|2026-08-05|true" WITH NO ADVANCING
           DISPLAY ""
           DISPLAY "TRANSACTION|seed-tx-004|seed-checking|Restaurant|Leisure|expense"
           DISPLAY "|12000|2026-08-07|false" WITH NO ADVANCING
           DISPLAY ""
           DISPLAY "TRANSACTION|seed-tx-005|seed-checking|Refund|Refund|income"
           DISPLAY "|5000|2026-08-10|false" WITH NO ADVANCING
           DISPLAY ""
           DISPLAY "GOAL|seed-goal-001|Emergency fund|600000|250000|2027-08-01"
           DISPLAY "END|2|5|1"
           STOP RUN.
