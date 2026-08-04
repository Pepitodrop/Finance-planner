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
       01 WS-AMOUNT                 PIC S9(15) COMP-5.
       01 WS-LIMIT                  PIC S9(15) COMP-5.
       01 WS-PENDING                PIC S9(15) COMP-5.
       01 WS-AVAILABLE              PIC S9(15) COMP-5.
       01 WS-OWED                   PIC S9(15) COMP-5.
       01 WS-LEDGER                 PIC S9(15) COMP-5.
       01 WS-STATUS                 PIC X(16).
       01 WS-NORMALIZED-TYPE        PIC X(16).
       01 WS-ARG-COUNT              PIC 9(4) COMP-5.
       01 WS-TEXT-AMOUNT            PIC -999999999999999.
       01 WS-TEXT-LIMIT             PIC -999999999999999.
       01 WS-TEXT-PENDING           PIC -999999999999999.
       01 WS-TEXT-AVAILABLE         PIC -999999999999999.
       01 WS-TEXT-OWED              PIC -999999999999999.
       01 WS-TEXT-LEDGER            PIC -999999999999999.

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
                 PERFORM NORMALIZE-ACCOUNT-TYPE
              WHEN "normalize-credit-card"
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

       NORMALIZE-CREDIT-CARD.
           IF WS-ARG-COUNT < 5
              DISPLAY "ERROR|INVALID_ARGUMENTS"
              STOP RUN RETURNING 2
           END-IF
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
           MOVE WS-LEDGER TO WS-TEXT-LEDGER
           MOVE WS-AVAILABLE TO WS-TEXT-AVAILABLE
           MOVE WS-PENDING TO WS-TEXT-PENDING
           DISPLAY TRIM(WS-STATUS) "|"
             TRIM(WS-TEXT-OWED) "|"
             TRIM(WS-TEXT-LEDGER) "|"
             TRIM(WS-TEXT-AVAILABLE) "|"
             TRIM(WS-TEXT-PENDING).
