>>SOURCE FORMAT IS FREE
IDENTIFICATION DIVISION.
PROGRAM-ID. FINANCE-TEST-ACCOUNT-EMPTY.

PROCEDURE DIVISION.
MAIN.
    *> Deterministic empty finance payload for the configured test identity.
    *> Node.js remains responsible for authentication, password verification,
    *> encryption and PostgreSQL persistence. No credentials enter COBOL.
    DISPLAY '{'
    DISPLAY '  "state": {'
    DISPLAY '    "accounts": [],'
    DISPLAY '    "transactions": [],'
    DISPLAY '    "goals": []'
    DISPLAY '  },'
    DISPLAY '  "secureData": {'
    DISPLAY '    "testAccount": {"generator":"gnucobol","mode":"empty","version":1}'
    DISPLAY '  }'
    DISPLAY '}'
    STOP RUN.
