       IDENTIFICATION DIVISION.
       PROGRAM-ID. BANKING-CORE.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       REPOSITORY.
           FUNCTION ALL INTRINSIC.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-OPERATION              PIC X(32).
       01 WS-ACCOUNT-TYPE           PIC X(32).
       01 WS-PROVIDER               PIC X(32).
       01 WS-PROVIDER-STATUS        PIC X(32).
       01 WS-SCOPE                  PIC X(128).
       01 WS-DECIMAL-TEXT           PIC X(32).
       01 WS-WHOLE                  PIC X(24).
       01 WS-FRACTION               PIC X(8).
       01 WS-FRACTION-LENGTH        PIC 9(4) COMP-5.
       01 WS-MATCH-COUNT            PIC 9(4) COMP-5.
       01 WS-TEST-NUMVAL            PIC 9(4) COMP-5.
       01 WS-DECIMAL-AMOUNT         PIC S9(13)V99 COMP-3.
       01 WS-CENTS                  PIC S9(15) COMP-5.
       01 WS-AMOUNT                 PIC S9(15) COMP-5.
       01 WS-LIMIT                  PIC S9(15) COMP-5.
       01 WS-PENDING                PIC S9(15) COMP-5.
       01 WS-AVAILABLE              PIC S9(15) COMP-5.
       01 WS-OWED                   PIC S9(15) COMP-5.
       01 WS-LEDGER                 PIC S9(15) COMP-5.
       01 WS-STATUS                 PIC X(16).
       01 WS-NORMALIZED-TYPE        PIC X(16).
       01 WS-CONSENT-STATE          PIC X(16).
       01 WS-ARG-COUNT              PIC 9(4) COMP-5.
       01 WS-TEXT-AMOUNT            PIC -ZZZZZZZZZZZZZZ9.
       01 WS-TEXT-LIMIT             PIC -ZZZZZZZZZZZZZZ9.
       01 WS-TEXT-PENDING           PIC -ZZZZZZZZZZZZZZ9.
       01 WS-TEXT-AVAILABLE         PIC -ZZZZZZZZZZZZZZ9.
       01 WS-TEXT-OWED              PIC -ZZZZZZZZZZZZZZ9.
       01 WS-TEXT-LEDGER            PIC ZZZZZZZZZZZZZZ9.
       01 WS-TEXT-CENTS             PIC -ZZZZZZZZZZZZZZ9.
       01 WS-TEXT-ACCOUNT-COUNT     PIC X(12).
       01 WS-TEXT-RECONCILED-COUNT  PIC X(12).
       01 WS-TEXT-TRANSACTION-COUNT PIC X(12).
       01 WS-TEXT-UNIQUE-COUNT      PIC X(12).
       01 WS-ACCOUNT-COUNT          PIC 9(9) COMP-5.
       01 WS-RECONCILED-COUNT       PIC 9(9) COMP-5.
       01 WS-TRANSACTION-COUNT      PIC 9(9) COMP-5.
       01 WS-UNIQUE-COUNT           PIC 9(9) COMP-5.
       01 WS-DATE-FROM              PIC X(10).
       01 WS-DATE-TO                PIC X(10).
       01 WS-DATE-CHECK             PIC X(10).
       01 WS-DATE-VALID             PIC X.
       01 WS-YEAR                   PIC 9(4) COMP-5.
       01 WS-MONTH                  PIC 9(2) COMP-5.
       01 WS-DAY                    PIC 9(2) COMP-5.

       PROCEDURE DIVISION.
       MAIN.
           ACCEPT WS-ARG-COUNT FROM ARGUMENT-NUMBER
           IF WS-ARG-COUNT < 2
              DISPLAY "ERROR|INVALID_ARGUMENTS"
              STOP RUN RETURNING 2
           END-IF

           ACCEPT WS-OPERATION FROM ARGUMENT-VALUE
           EVALUATE TRIM(WS-OPERATION)
              WHEN "normalize-account-type"
                 IF WS-ARG-COUNT NOT = 2
                    DISPLAY "ERROR|INVALID_ARGUMENTS"
                    STOP RUN RETURNING 2
                 END-IF
                 PERFORM NORMALIZE-ACCOUNT-TYPE
              WHEN "normalize-provider-account-type"
                 IF WS-ARG-COUNT NOT = 2
                    DISPLAY "ERROR|INVALID_ARGUMENTS"
                    STOP RUN RETURNING 2
                 END-IF
                 PERFORM NORMALIZE-PROVIDER-ACCOUNT-TYPE
              WHEN "normalize-provider-amount"
                 IF WS-ARG-COUNT NOT = 2
                    DISPLAY "ERROR|INVALID_ARGUMENTS"
                    STOP RUN RETURNING 2
                 END-IF
                 PERFORM NORMALIZE-PROVIDER-AMOUNT
              WHEN "validate-provider-consent"
                 IF WS-ARG-COUNT NOT = 3
                    DISPLAY "ERROR|INVALID_ARGUMENTS"
                    STOP RUN RETURNING 2
                 END-IF
                 PERFORM VALIDATE-PROVIDER-CONSENT
              WHEN "validate-read-only-scope"
                 IF WS-ARG-COUNT NOT = 2
                    DISPLAY "ERROR|INVALID_ARGUMENTS"
                    STOP RUN RETURNING 2
                 END-IF
                 PERFORM VALIDATE-READ-ONLY-SCOPE
              WHEN "validate-provider-reconciliation"
                 IF WS-ARG-COUNT NOT = 7
                    DISPLAY "ERROR|INVALID_ARGUMENTS"
                    STOP RUN RETURNING 2
                 END-IF
                 PERFORM VALIDATE-PROVIDER-RECONCILIATION
              WHEN "normalize-credit-card"
                 IF WS-ARG-COUNT NOT = 4
                    DISPLAY "ERROR|INVALID_ARGUMENTS"
                    STOP RUN RETURNING 2
                 END-IF
                 PERFORM NORMALIZE-CREDIT-CARD
              WHEN OTHER
                 DISPLAY "ERROR|UNKNOWN_OPERATION"
                 STOP RUN RETURNING 2
           END-EVALUATE
           STOP RUN RETURNING 0.

       NORMALIZE-ACCOUNT-TYPE.
           ACCEPT WS-ACCOUNT-TYPE FROM ARGUMENT-VALUE
           MOVE FUNCTION LOWER-CASE(TRIM(WS-ACCOUNT-TYPE))
             TO WS-ACCOUNT-TYPE
           EVALUATE TRIM(WS-ACCOUNT-TYPE)
              WHEN "girokonto" WHEN "current" WHEN "checking"
                 MOVE "checking" TO WS-NORMALIZED-TYPE
              WHEN "sparkonto" WHEN "savings" WHEN "deposit"
                 MOVE "savings" TO WS-NORMALIZED-TYPE
              WHEN "cash" WHEN "bargeld"
                 MOVE "cash" TO WS-NORMALIZED-TYPE
              WHEN "depot" WHEN "investment" WHEN "brokerage"
                 MOVE "investment" TO WS-NORMALIZED-TYPE
              WHEN "credit-card" WHEN "creditcard"
              WHEN "kreditkarte" WHEN "card"
                 MOVE "credit-card" TO WS-NORMALIZED-TYPE
              WHEN OTHER
                 DISPLAY "ERROR|UNSUPPORTED_ACCOUNT_TYPE"
                 STOP RUN RETURNING 3
           END-EVALUATE
           DISPLAY "OK|" TRIM(WS-NORMALIZED-TYPE).

       NORMALIZE-PROVIDER-ACCOUNT-TYPE.
           ACCEPT WS-ACCOUNT-TYPE FROM ARGUMENT-VALUE
           MOVE FUNCTION UPPER-CASE(TRIM(WS-ACCOUNT-TYPE))
             TO WS-ACCOUNT-TYPE
           EVALUATE TRIM(WS-ACCOUNT-TYPE)
              WHEN "SVGS" WHEN "SAVINGS" WHEN "DEPOSIT"
                 MOVE "savings" TO WS-NORMALIZED-TYPE
              WHEN "CASH"
                 MOVE "cash" TO WS-NORMALIZED-TYPE
              WHEN "CARD" WHEN "CREDITCARD" WHEN "CREDIT-CARD"
                 MOVE "credit-card" TO WS-NORMALIZED-TYPE
              WHEN "INVE" WHEN "INVESTMENT" WHEN "BROKERAGE"
              WHEN "TRAS"
                 MOVE "investment" TO WS-NORMALIZED-TYPE
              WHEN OTHER
                 MOVE "checking" TO WS-NORMALIZED-TYPE
           END-EVALUATE
           DISPLAY "OK|" TRIM(WS-NORMALIZED-TYPE).

       NORMALIZE-PROVIDER-AMOUNT.
           ACCEPT WS-DECIMAL-TEXT FROM ARGUMENT-VALUE
           MOVE FUNCTION TEST-NUMVAL(TRIM(WS-DECIMAL-TEXT))
             TO WS-TEST-NUMVAL
           IF WS-TEST-NUMVAL NOT = 0
              DISPLAY "ERROR|INVALID_PROVIDER_AMOUNT"
              STOP RUN RETURNING 3
           END-IF

           MOVE 0 TO WS-MATCH-COUNT
           INSPECT WS-DECIMAL-TEXT
              TALLYING WS-MATCH-COUNT FOR ALL "."
           IF WS-MATCH-COUNT > 1
              DISPLAY "ERROR|INVALID_PROVIDER_AMOUNT"
              STOP RUN RETURNING 3
           END-IF
           IF WS-MATCH-COUNT = 1
              MOVE SPACES TO WS-WHOLE WS-FRACTION
              UNSTRING TRIM(WS-DECIMAL-TEXT)
                 DELIMITED BY "."
                 INTO WS-WHOLE WS-FRACTION
              END-UNSTRING
              MOVE 0 TO WS-FRACTION-LENGTH
              INSPECT WS-FRACTION
                 TALLYING WS-FRACTION-LENGTH
                 FOR CHARACTERS BEFORE INITIAL SPACE
              IF WS-FRACTION-LENGTH > 2
                 DISPLAY "ERROR|INVALID_PROVIDER_AMOUNT"
                 STOP RUN RETURNING 3
              END-IF
           END-IF

           MOVE FUNCTION NUMVAL(TRIM(WS-DECIMAL-TEXT))
             TO WS-DECIMAL-AMOUNT
           COMPUTE WS-CENTS = WS-DECIMAL-AMOUNT * 100
           MOVE WS-CENTS TO WS-TEXT-CENTS
           DISPLAY "OK|" TRIM(WS-TEXT-CENTS).

       VALIDATE-PROVIDER-CONSENT.
           ACCEPT WS-PROVIDER FROM ARGUMENT-VALUE
           ACCEPT WS-PROVIDER-STATUS FROM ARGUMENT-VALUE
           MOVE FUNCTION LOWER-CASE(TRIM(WS-PROVIDER))
             TO WS-PROVIDER
           MOVE FUNCTION UPPER-CASE(TRIM(WS-PROVIDER-STATUS))
             TO WS-PROVIDER-STATUS

           IF TRIM(WS-PROVIDER) = "gocardless"
              EVALUATE TRIM(WS-PROVIDER-STATUS)
                 WHEN "LN"
                    MOVE "ready" TO WS-CONSENT-STATE
                 WHEN "EX" WHEN "RJ" WHEN "SU"
                    MOVE "expired" TO WS-CONSENT-STATE
                 WHEN OTHER
                    MOVE "pending" TO WS-CONSENT-STATE
              END-EVALUATE
           ELSE
              EVALUATE TRIM(WS-PROVIDER-STATUS)
                 WHEN "ACTIVE" WHEN "AUTHORIZED" WHEN "READY"
                    MOVE "ready" TO WS-CONSENT-STATE
                 WHEN "EXPIRED" WHEN "REVOKED" WHEN "REJECTED"
                    MOVE "expired" TO WS-CONSENT-STATE
                 WHEN OTHER
                    MOVE "pending" TO WS-CONSENT-STATE
              END-EVALUATE
           END-IF
           DISPLAY "OK|" TRIM(WS-CONSENT-STATE).

       VALIDATE-READ-ONLY-SCOPE.
           ACCEPT WS-SCOPE FROM ARGUMENT-VALUE
           MOVE FUNCTION LOWER-CASE(TRIM(WS-SCOPE)) TO WS-SCOPE

           MOVE 0 TO WS-MATCH-COUNT
           INSPECT WS-SCOPE
              TALLYING WS-MATCH-COUNT FOR ALL "payment"
           IF WS-MATCH-COUNT > 0
              DISPLAY "ERROR|MONEY_MOVEMENT_SCOPE_FORBIDDEN"
              STOP RUN RETURNING 4
           END-IF

           MOVE 0 TO WS-MATCH-COUNT
           INSPECT WS-SCOPE
              TALLYING WS-MATCH-COUNT FOR ALL "payout"
           IF WS-MATCH-COUNT > 0
              DISPLAY "ERROR|MONEY_MOVEMENT_SCOPE_FORBIDDEN"
              STOP RUN RETURNING 4
           END-IF

           MOVE 0 TO WS-MATCH-COUNT
           INSPECT WS-SCOPE
              TALLYING WS-MATCH-COUNT FOR ALL "transfer"
           IF WS-MATCH-COUNT > 0
              DISPLAY "ERROR|MONEY_MOVEMENT_SCOPE_FORBIDDEN"
              STOP RUN RETURNING 4
           END-IF

           MOVE 0 TO WS-MATCH-COUNT
           INSPECT WS-SCOPE
              TALLYING WS-MATCH-COUNT FOR ALL "order"
           IF WS-MATCH-COUNT > 0
              DISPLAY "ERROR|MONEY_MOVEMENT_SCOPE_FORBIDDEN"
              STOP RUN RETURNING 4
           END-IF

           MOVE 0 TO WS-MATCH-COUNT
           INSPECT WS-SCOPE
              TALLYING WS-MATCH-COUNT FOR ALL "mandate"
           IF WS-MATCH-COUNT > 0
              DISPLAY "ERROR|MONEY_MOVEMENT_SCOPE_FORBIDDEN"
              STOP RUN RETURNING 4
           END-IF

           MOVE 0 TO WS-MATCH-COUNT
           INSPECT WS-SCOPE
              TALLYING WS-MATCH-COUNT FOR ALL "debit"
           IF WS-MATCH-COUNT > 0
              DISPLAY "ERROR|MONEY_MOVEMENT_SCOPE_FORBIDDEN"
              STOP RUN RETURNING 4
           END-IF

           MOVE 0 TO WS-MATCH-COUNT
           INSPECT WS-SCOPE
              TALLYING WS-MATCH-COUNT FOR ALL "balance"
           INSPECT WS-SCOPE
              TALLYING WS-MATCH-COUNT FOR ALL "detail"
           INSPECT WS-SCOPE
              TALLYING WS-MATCH-COUNT FOR ALL "transaction"
           INSPECT WS-SCOPE
              TALLYING WS-MATCH-COUNT FOR ALL "report"
           IF WS-MATCH-COUNT = 0
              DISPLAY "ERROR|READ_ONLY_SCOPE_REQUIRED"
              STOP RUN RETURNING 4
           END-IF
           DISPLAY "OK|read-only".

       VALIDATE-PROVIDER-RECONCILIATION.
           ACCEPT WS-TEXT-ACCOUNT-COUNT FROM ARGUMENT-VALUE
           ACCEPT WS-TEXT-RECONCILED-COUNT FROM ARGUMENT-VALUE
           ACCEPT WS-TEXT-TRANSACTION-COUNT FROM ARGUMENT-VALUE
           ACCEPT WS-TEXT-UNIQUE-COUNT FROM ARGUMENT-VALUE
           ACCEPT WS-DATE-FROM FROM ARGUMENT-VALUE
           ACCEPT WS-DATE-TO FROM ARGUMENT-VALUE

           IF FUNCTION TEST-NUMVAL(TRIM(WS-TEXT-ACCOUNT-COUNT))
              NOT = 0
              OR FUNCTION TEST-NUMVAL(
                 TRIM(WS-TEXT-RECONCILED-COUNT)) NOT = 0
              OR FUNCTION TEST-NUMVAL(
                 TRIM(WS-TEXT-TRANSACTION-COUNT)) NOT = 0
              OR FUNCTION TEST-NUMVAL(TRIM(WS-TEXT-UNIQUE-COUNT))
                 NOT = 0
              DISPLAY "ERROR|INVALID_RECONCILIATION_COUNT"
              STOP RUN RETURNING 5
           END-IF

           MOVE FUNCTION NUMVAL(TRIM(WS-TEXT-ACCOUNT-COUNT))
             TO WS-ACCOUNT-COUNT
           MOVE FUNCTION NUMVAL(TRIM(WS-TEXT-RECONCILED-COUNT))
             TO WS-RECONCILED-COUNT
           MOVE FUNCTION NUMVAL(TRIM(WS-TEXT-TRANSACTION-COUNT))
             TO WS-TRANSACTION-COUNT
           MOVE FUNCTION NUMVAL(TRIM(WS-TEXT-UNIQUE-COUNT))
             TO WS-UNIQUE-COUNT

           IF WS-RECONCILED-COUNT NOT = WS-ACCOUNT-COUNT
              DISPLAY "ERROR|ACCOUNT_RECONCILIATION_INCOMPLETE"
              STOP RUN RETURNING 5
           END-IF
           IF WS-UNIQUE-COUNT NOT = WS-TRANSACTION-COUNT
              DISPLAY "ERROR|DUPLICATE_TRANSACTIONS_DETECTED"
              STOP RUN RETURNING 5
           END-IF

           MOVE WS-DATE-FROM TO WS-DATE-CHECK
           PERFORM VALIDATE-DATE-CHECK
           IF WS-DATE-VALID NOT = "Y"
              DISPLAY "ERROR|INVALID_RECONCILIATION_DATE"
              STOP RUN RETURNING 5
           END-IF
           MOVE WS-DATE-TO TO WS-DATE-CHECK
           PERFORM VALIDATE-DATE-CHECK
           IF WS-DATE-VALID NOT = "Y"
              DISPLAY "ERROR|INVALID_RECONCILIATION_DATE"
              STOP RUN RETURNING 5
           END-IF
           IF WS-DATE-FROM > WS-DATE-TO
              DISPLAY "ERROR|RECONCILIATION_DATE_REVERSED"
              STOP RUN RETURNING 5
           END-IF
           DISPLAY "OK|reconciled".

       VALIDATE-DATE-CHECK.
           MOVE "Y" TO WS-DATE-VALID
           IF WS-DATE-CHECK(5:1) NOT = "-"
              OR WS-DATE-CHECK(8:1) NOT = "-"
              MOVE "N" TO WS-DATE-VALID
           END-IF
           IF WS-DATE-VALID = "Y"
              IF FUNCTION TEST-NUMVAL(WS-DATE-CHECK(1:4)) NOT = 0
                 OR FUNCTION TEST-NUMVAL(WS-DATE-CHECK(6:2))
                    NOT = 0
                 OR FUNCTION TEST-NUMVAL(WS-DATE-CHECK(9:2))
                    NOT = 0
                 MOVE "N" TO WS-DATE-VALID
              END-IF
           END-IF
           IF WS-DATE-VALID = "Y"
              MOVE FUNCTION NUMVAL(WS-DATE-CHECK(1:4)) TO WS-YEAR
              MOVE FUNCTION NUMVAL(WS-DATE-CHECK(6:2)) TO WS-MONTH
              MOVE FUNCTION NUMVAL(WS-DATE-CHECK(9:2)) TO WS-DAY
              IF WS-YEAR < 1970 OR WS-YEAR > 9999
                 OR WS-MONTH < 1 OR WS-MONTH > 12
                 OR WS-DAY < 1 OR WS-DAY > 31
                 MOVE "N" TO WS-DATE-VALID
              END-IF
           END-IF.

       NORMALIZE-CREDIT-CARD.
           ACCEPT WS-TEXT-AMOUNT FROM ARGUMENT-VALUE
           ACCEPT WS-TEXT-LIMIT FROM ARGUMENT-VALUE
           ACCEPT WS-TEXT-PENDING FROM ARGUMENT-VALUE
           MOVE FUNCTION NUMVAL(TRIM(WS-TEXT-AMOUNT)) TO WS-AMOUNT
           MOVE FUNCTION NUMVAL(TRIM(WS-TEXT-LIMIT)) TO WS-LIMIT
           MOVE FUNCTION NUMVAL(TRIM(WS-TEXT-PENDING)) TO WS-PENDING

           IF WS-AMOUNT < 0
              COMPUTE WS-OWED = 0 - WS-AMOUNT
           ELSE
              MOVE WS-AMOUNT TO WS-OWED
           END-IF
           IF WS-PENDING < 0
              COMPUTE WS-PENDING = 0 - WS-PENDING
           END-IF
           COMPUTE WS-LEDGER = 0 - WS-OWED
           IF WS-LIMIT > 0
              COMPUTE WS-AVAILABLE = WS-LIMIT - WS-OWED - WS-PENDING
              IF WS-AVAILABLE < 0 MOVE 0 TO WS-AVAILABLE END-IF
           ELSE
              MOVE 0 TO WS-AVAILABLE
           END-IF
           MOVE "OK" TO WS-STATUS
           MOVE WS-OWED TO WS-TEXT-OWED
           MOVE WS-OWED TO WS-TEXT-LEDGER
           MOVE WS-AVAILABLE TO WS-TEXT-AVAILABLE
           MOVE WS-PENDING TO WS-TEXT-PENDING
           DISPLAY TRIM(WS-STATUS) "|"
             TRIM(WS-TEXT-OWED) "|-"
             TRIM(WS-TEXT-LEDGER) "|"
             TRIM(WS-TEXT-AVAILABLE) "|"
             TRIM(WS-TEXT-PENDING).
