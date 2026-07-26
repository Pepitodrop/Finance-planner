       IDENTIFICATION DIVISION.
       PROGRAM-ID. TRANSACTION-RULES.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-MODE                  PIC X(16) VALUE SPACES.
       01  WS-ARG                   PIC X(40) VALUE SPACES.
       01  WS-AMOUNT                PIC S9(15) VALUE 0.
       01  WS-BALANCE               PIC S9(15) VALUE 0.
       01  WS-RESULT                PIC S9(15) VALUE 0.
       01  WS-ABS-AMOUNT            PIC 9(15) VALUE 0.
       01  WS-TYPE                  PIC X(7) VALUE SPACES.
       01  WS-DISPLAY-NUMBER        PIC -Z(14)9.

       PROCEDURE DIVISION.
           ACCEPT WS-MODE FROM ARGUMENT-VALUE

           EVALUATE FUNCTION TRIM(WS-MODE)
               WHEN "NORMALIZE"
                   PERFORM NORMALIZE-AMOUNT
               WHEN "APPLY"
                   PERFORM APPLY-TRANSACTION
               WHEN OTHER
                   DISPLAY "ERROR|UNKNOWN_MODE"
                   MOVE 2 TO RETURN-CODE
           END-EVALUATE

           GOBACK.

       NORMALIZE-AMOUNT.
           ACCEPT WS-ARG FROM ARGUMENT-VALUE
           COMPUTE WS-AMOUNT = FUNCTION NUMVAL(WS-ARG)
               ON SIZE ERROR
                   DISPLAY "ERROR|INVALID_AMOUNT"
                   MOVE 2 TO RETURN-CODE
                   EXIT PARAGRAPH
           END-COMPUTE

           IF WS-AMOUNT < 0
               MOVE "expense" TO WS-TYPE
               COMPUTE WS-ABS-AMOUNT = 0 - WS-AMOUNT
           ELSE
               MOVE "income" TO WS-TYPE
               MOVE WS-AMOUNT TO WS-ABS-AMOUNT
           END-IF

           MOVE WS-ABS-AMOUNT TO WS-DISPLAY-NUMBER
           DISPLAY "OK|" FUNCTION TRIM(WS-TYPE) "|"
               FUNCTION TRIM(WS-DISPLAY-NUMBER).

       APPLY-TRANSACTION.
           ACCEPT WS-ARG FROM ARGUMENT-VALUE
           COMPUTE WS-BALANCE = FUNCTION NUMVAL(WS-ARG)
               ON SIZE ERROR
                   DISPLAY "ERROR|INVALID_BALANCE"
                   MOVE 2 TO RETURN-CODE
                   EXIT PARAGRAPH
           END-COMPUTE

           ACCEPT WS-ARG FROM ARGUMENT-VALUE
           COMPUTE WS-AMOUNT = FUNCTION NUMVAL(WS-ARG)
               ON SIZE ERROR
                   DISPLAY "ERROR|INVALID_AMOUNT"
                   MOVE 2 TO RETURN-CODE
                   EXIT PARAGRAPH
           END-COMPUTE

           ACCEPT WS-TYPE FROM ARGUMENT-VALUE
           EVALUATE FUNCTION TRIM(WS-TYPE)
               WHEN "income"
                   COMPUTE WS-RESULT = WS-BALANCE + WS-AMOUNT
               WHEN "expense"
                   COMPUTE WS-RESULT = WS-BALANCE - WS-AMOUNT
               WHEN OTHER
                   DISPLAY "ERROR|INVALID_TYPE"
                   MOVE 2 TO RETURN-CODE
                   EXIT PARAGRAPH
           END-EVALUATE

           MOVE WS-RESULT TO WS-DISPLAY-NUMBER
           DISPLAY "OK|" FUNCTION TRIM(WS-DISPLAY-NUMBER).
