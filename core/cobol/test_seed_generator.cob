>>SOURCE FORMAT IS FREE
IDENTIFICATION DIVISION.
PROGRAM-ID. FINANCE-TEST-SEED.

DATA DIVISION.
WORKING-STORAGE SECTION.
01 WS-MONTH PIC 99 VALUE 1.

PROCEDURE DIVISION.
MAIN.
    *> Comprehensive deterministic test data only. Node.js remains
    *> responsible for authentication, encryption and PostgreSQL persistence.
    *> This generator contains no credentials and never runs at app startup.
    DISPLAY '{'
    DISPLAY '  "state": {'
    DISPLAY '    "accounts": ['
    DISPLAY '      {"id":"seed-checking","name":"Test Girokonto","type":"checking","balanceCents":734250,"currency":"EUR"},'
    DISPLAY '      {"id":"seed-savings","name":"Test Tagesgeld","type":"savings","balanceCents":1525000,"currency":"EUR"},'
    DISPLAY '      {"id":"seed-cash","name":"Test Bargeld","type":"cash","balanceCents":18550,"currency":"EUR"},'
    DISPLAY '      {"id":"seed-investment","name":"Test Depot","type":"investment","balanceCents":840000,"currency":"EUR"},'
    DISPLAY '      {"id":"seed-card","name":"Test Kreditkarte","type":"credit-card","balanceCents":-84530,"currency":"EUR"}'
    DISPLAY '    ],'
    DISPLAY '    "transactions": ['

    PERFORM VARYING WS-MONTH FROM 1 BY 1 UNTIL WS-MONTH > 8
        DISPLAY '      {"id":"salary-' WS-MONTH '","accountId":"seed-checking","description":"Test Salary","category":"Income","type":"income","amountCents":295000,"date":"2026-' WS-MONTH '-01","recurring":true},'
        DISPLAY '      {"id":"rent-' WS-MONTH '","accountId":"seed-checking","description":"Test Rent","category":"Housing","type":"expense","amountCents":98000,"date":"2026-' WS-MONTH '-02","recurring":true},'
        DISPLAY '      {"id":"internet-' WS-MONTH '","accountId":"seed-checking","description":"Test Internet","category":"Utilities","type":"expense","amountCents":4999,"date":"2026-' WS-MONTH '-05","recurring":true},'
        DISPLAY '      {"id":"mobile-' WS-MONTH '","accountId":"seed-checking","description":"Test Mobile","category":"Utilities","type":"expense","amountCents":2499,"date":"2026-' WS-MONTH '-06","recurring":true},'
        DISPLAY '      {"id":"streaming-' WS-MONTH '","accountId":"seed-card","description":"Test Streaming","category":"Subscriptions","type":"expense","amountCents":1799,"date":"2026-' WS-MONTH '-08","recurring":true},'
        DISPLAY '      {"id":"fitness-' WS-MONTH '","accountId":"seed-card","description":"Test Fitness","category":"Health","type":"expense","amountCents":3499,"date":"2026-' WS-MONTH '-10","recurring":true},'
        DISPLAY '      {"id":"groceries-a-' WS-MONTH '","accountId":"seed-checking","description":"Test Supermarket","category":"Groceries","type":"expense","amountCents":9200,"date":"2026-' WS-MONTH '-11"},'
        DISPLAY '      {"id":"groceries-b-' WS-MONTH '","accountId":"seed-card","description":"Test Grocery Store","category":"Groceries","type":"expense","amountCents":6100,"date":"2026-' WS-MONTH '-18"},'
        DISPLAY '      {"id":"transport-' WS-MONTH '","accountId":"seed-card","description":"Test Transit","category":"Transport","type":"expense","amountCents":5800,"date":"2026-' WS-MONTH '-12"},'
        DISPLAY '      {"id":"dining-' WS-MONTH '","accountId":"seed-card","description":"Test Restaurant","category":"Dining","type":"expense","amountCents":5200,"date":"2026-' WS-MONTH '-16"},'
        DISPLAY '      {"id":"cash-' WS-MONTH '","accountId":"seed-cash","description":"Test Cash Purchase","category":"Leisure","type":"expense","amountCents":1750,"date":"2026-' WS-MONTH '-20"},'
        DISPLAY '      {"id":"savings-out-' WS-MONTH '","accountId":"seed-checking","description":"Transfer to savings","category":"Transfer","type":"expense","amountCents":30000,"date":"2026-' WS-MONTH '-25","recurring":true},'
        DISPLAY '      {"id":"savings-in-' WS-MONTH '","accountId":"seed-savings","description":"Transfer from checking","category":"Transfer","type":"income","amountCents":30000,"date":"2026-' WS-MONTH '-25","recurring":true},'
    END-PERFORM

    DISPLAY '      {"id":"insurance-2026","accountId":"seed-checking","description":"Test Insurance","category":"Insurance","type":"expense","amountCents":78000,"date":"2026-01-15","recurring":true},'
    DISPLAY '      {"id":"travel-hotel-202604","accountId":"seed-card","description":"Test Hotel","category":"Travel","type":"expense","amountCents":145000,"date":"2026-04-21"},'
    DISPLAY '      {"id":"travel-flight-202604","accountId":"seed-card","description":"Test Flight","category":"Travel","type":"expense","amountCents":89000,"date":"2026-04-19"},'
    DISPLAY '      {"id":"electronics-202605","accountId":"seed-card","description":"Test Electronics","category":"Shopping","type":"expense","amountCents":129900,"date":"2026-05-14"},'
    DISPLAY '      {"id":"dividend-202606","accountId":"seed-investment","description":"Test Dividend","category":"Investment","type":"income","amountCents":18500,"date":"2026-06-30"},'
    DISPLAY '      {"id":"investment-buy-202607","accountId":"seed-investment","description":"Test Investment Purchase","category":"Investment","type":"expense","amountCents":50000,"date":"2026-07-15"},'
    DISPLAY '      {"id":"gift-202608","accountId":"seed-cash","description":"Test Gift","category":"Gifts","type":"expense","amountCents":7500,"date":"2026-08-14"}'
    DISPLAY '    ],'
    DISPLAY '    "goals": ['
    DISPLAY '      {"id":"goal-emergency","name":"Emergency fund","targetCents":1000000,"currentCents":650000,"targetDate":"2027-03-31"},'
    DISPLAY '      {"id":"goal-holiday","name":"Summer holiday","targetCents":250000,"currentCents":110000,"targetDate":"2027-06-01"},'
    DISPLAY '      {"id":"goal-laptop","name":"New laptop","targetCents":220000,"currentCents":80000,"targetDate":"2026-12-15"},'
    DISPLAY '      {"id":"goal-car","name":"Car reserve","targetCents":500000,"currentCents":125000,"targetDate":"2028-01-01"},'
    DISPLAY '      {"id":"goal-invest","name":"Investment milestone","targetCents":2000000,"currentCents":840000,"targetDate":"2029-12-31"}'
    DISPLAY '    ]'
    DISPLAY '  },'
    DISPLAY '  "secureData": {'
    DISPLAY '    "testSeed": {"generator":"gnucobol","mode":"comprehensive","version":2,"scenario":"full-ui"}'
    DISPLAY '  }'
    DISPLAY '}'
    STOP RUN.
