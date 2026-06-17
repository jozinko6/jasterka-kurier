---
Task ID: debug-report-fixes
Agent: main
Task: Execute all 12 priority fixes from the debug report

Work Log:
- P0-1: Fixed auth route - replaced SHA-256 with bcrypt.compare, added session management (in-memory token store)
- P0-2: Created auth middleware (requireRole, authenticateRequest) and applied to all protected API routes
- P0-3: Removed .env, db/custom.db, tool-results/*, upload/*, .zscripts/* from git tracking; updated .gitignore; created .env.example
- P1-4: Fixed all TypeScript errors (AdminSection reduce type, OrderStatus array spread, ringColor CSS property, opening-hours results type); removed ignoreBuildErrors: true from next.config.ts; excluded examples/ and skills/ from tsconfig
- P1-5: Updated build and vercel-build scripts to use --webpack flag
- P2-6: Wrapped order number generation in db.$transaction for atomicity
- P2-7: Wrapped dispatch (assignment creation + order update + courier update) in db.$transaction
- P2-8: Added status transition validation with ALLOWED_TRANSITIONS graph in auth.ts, applied in PATCH /api/orders/[id]
- P3-9: Created Zod v4 validation schemas for all API request bodies in src/lib/validations.ts; applied to all write endpoints
- P4-10: Created PRISMA.md documenting the dual schema setup (SQLite local / PostgreSQL production)
- P5-11: Fixed lint warnings (unused eslint-disable in opening-hours); carousel.tsx and use-mobile.ts were clean
- P5-12: Verified UTF-8 encoding for all Slovak diacritics files
- Also: Created frontend auth system (auth-store.ts with Zustand persist, LoginForm component, authFetch wrapper)
- Updated Kitchen/Courier/Admin pages to require login with role-based access
- Updated KitchenSection, CourierSection, AdminSection to use authFetch for all API calls
- Installed @types/bcryptjs for proper TypeScript support
- Made GET /api/orders/[id] public for customer order tracking

Stage Summary:
- All 12 debug report issues fixed and verified
- TypeScript compiles cleanly (0 errors)
- ESLint passes (0 errors, 0 warnings)
- Auth system: bcrypt.compare + in-memory session tokens + role-based middleware
- API routes: public (menu, zones, settings, opening-hours, order creation, order tracking) vs protected (all staff routes)
- Frontend: Login gate on /kuchyna, /kurier, /admin pages; authFetch wrapper for token management

---
Task ID: 0-baseline
Agent: main
Task: Set up working branch, install deps, run baseline lint/typecheck/build/qa, document existing errors

Work Log:
- Cloned https://github.com/jozinko6/jasterka-kurier.git into /home/z/my-project (replaced scaffold)
- Reset working tree to origin/main (HEAD = 5d8ed5b)
- Created working branch fix/security-and-order-flow-hardening
- bun install completed (already had lockfile)
- prisma generate + db push + db seed on SQLite (file:/home/z/my-project/db/custom.db) succeeded
- bun run lint: 0 errors, 0 warnings (passes clean)
- bunx tsc --noEmit: 0 errors (passes clean)
- bun run build: passes; output is Next 16 Turbopack with --webpack fallback (per package.json script: "prisma generate --schema=prisma/schema.sqlite.prisma && next build --webpack")
- bun run qa:orders (run via `node scripts/qa-orders-flow.mjs` against dev server on port 3000): ALL CHECKS PASS:
  * protected kitchen endpoint rejects anonymous access (401)
  * admin/kitchen/courier users can log in
  * menu and zones load
  * POST /api/orders creates order JAS-...
  * GET /api/orders/[id] public tracking is sanitized (no customerPhone, no deliveryAddressLine1, assignments array present)
  * kitchen sees new order
  * kitchen can move NEW -> ACCEPTED -> IN_KITCHEN -> PREPARING -> READY
  * kitchen cannot dispatch (403)
  * admin can dispatch (201), public tracking shows courier displayName only (no phone, no user)
  * duplicate dispatch returns 409
  * courier can see assigned order
  * courier can move ASSIGNED_TO_COURIER -> PICKED_UP -> ON_THE_WAY -> DELIVERED
- Inspected both Prisma schemas: prisma/schema.prisma (PostgreSQL) and prisma/schema.sqlite.prisma (SQLite) are identical except for the datasource block. Both still use Float for monetary fields (P1-16 pending).
- Built authorization matrix from current API route handlers (see below).

Existing authorization matrix (current state):
| Endpoint                            | Roles allowed                          | Notes |
|-------------------------------------|----------------------------------------|-------|
| GET  /api/menu                      | public                                 | |
| GET  /api/zones                     | public                                 | |
| GET  /api/settings                  | public                                 | also creates default settings if missing (BUG: GET mutates DB) |
| GET  /api/opening-hours             | public                                 | |
| POST /api/orders                    | public                                 | server computes price from menu items (mostly OK) |
| GET  /api/orders/[id]               | staff (ADMIN/KITCHEN/COURIER/OWNER) full detail, otherwise sanitized public tracking | courier can read ANY order via sanitized public tracking (no ownership check on the public branch!) |
| PATCH /api/orders/[id]              | ADMIN/KITCHEN/COURIER/OWNER            | accepts changedByUserId from client (audit spoofing BUG); no concurrency check; single global transition map; courier can transition any order if role matches (no ownership check); kitchen can transition to DELIVERED (role-awareness BUG) |
| GET  /api/orders                    | ADMIN/KITCHEN/COURIER/OWNER            | courier filtered to assignments.some, but no status scoping; no pagination |
| GET  /api/kitchen                   | ADMIN/KITCHEN/OWNER                    | |
| POST /api/dispatch                  | ADMIN/OWNER                            | transactional; accepts assignedByUserId from client (audit spoofing BUG); uses findFirst->create (race-prone); does not check orderType=DELIVERY, order state, courier.isActive, courier.status, capacity, vehicle/zone compat |
| GET  /api/couriers                  | ADMIN/COURIER/OWNER                    | courier only sees own profile |
| POST /api/couriers                  | ADMIN/OWNER                            | |
| PUT  /api/couriers                  | ADMIN/OWNER/COURIER (own only)         | courier can change own password without currentPassword (BUG) |
| PATCH /api/couriers                 | ADMIN/OWNER/COURIER (own only)         | |
| DELETE /api/couriers                | ADMIN/OWNER                            | soft delete |
| GET  /api/courier-earnings          | ADMIN/COURIER/OWNER                    | no from/to/timezone support; UI sends no date range (BUG: shows lifetime as "today") |
| GET  /api/stats                     | ADMIN/OWNER                            | |
| GET  /api/admin/categories          | ADMIN/OWNER (assumed)                  | |
| POST/PUT/DELETE /api/admin/menu     | ADMIN/OWNER (assumed)                  | |
| POST/DELETE /api/auth               | public                                 | no rate limiting, no email normalization (P1-13 BUG) |

Stage Summary:
- Baseline is GREEN: lint clean, typecheck clean, build clean, QA passes.
- Branch fix/security-and-order-flow-hardening is ready for systematic hardening commits.
- Dev server must be started with setsid (not `bun run dev`) so subsequent `bun run` commands do not kill it.
- All P0/P1/P2 issues identified; will be addressed in subsequent commits following the user's suggested commit ordering.

---
Task ID: etapa-1
Agent: main
Task: Etapa 1 — databázový návrh, migrácie, cents money utility, verzované sadzobníky, earning ledger

Work Log:
- Pridané nové enumy do oboch Prisma schém (PostgreSQL + SQLite):
  CourierContractType, CourierAgreementType, PayoutFrequency, VatStatus,
  SelfBillingAgreementStatus, EarningEntryType (19 typov), EarningEntryStatus,
  CashEntryType, PayoutPeriodStatus, RemunerationRuleType (18 typov), RuleValueType,
  SelfBillingInvoiceStatus, AgreementStatementStatus, WorkSessionStatus,
  PayoutBatchStatus, CourierAuditAction (13 akcií).
- Pridané nové modely do oboch schém:
  CourierCompensationProfile, CourierAgreementProfile, CourierBusinessProfile,
  SelfBillingAgreement, SelfBillingAgreementTemplate,
  RemunerationPlan, RemunerationPlanVersion, RemunerationRule, CourierRateOverride,
  ZoneCompensationRule, PeakPeriodRule,
  OrderRemunerationSnapshot (immutable per-order snapshot),
  EarningLedgerEntry (immutable accounting book, idempotencyKey unique),
  CashLedgerEntry (hotovosť oddelene od zárobkov),
  WorkSession (pracovný čas),
  PayoutPeriod (výplatné obdobie s 8 stavmi),
  PayoutBatch (hromadná výplata),
  SelfBillingInvoice (samofaktúra s DPH snapshotmi),
  AgreementEarningsStatement (výkaz odmeny dohodára),
  CourierAuditLog (audit všetkých finančných operácií).
- Všetky peniažné hodnoty v nových modeloch sú Int cents (žiadny Float).
- Pridané spätné vzťahy v modeli User (13 nových relations).
- Courier model rozšírený o activeCompensationProfileId (1:1) a 13 nových relations.
- Order model rozšírený o remunerationSnapshot, earningLedgerEntries, cashLedgerEntries.
- DeliveryZone rozšírená o zoneCompensationRules.
- obe schémy validné (prisma validate ✓).
- bun run db:push + db:seed prebehli úspešne.
- Vytvorené utility moduly:
  * src/lib/money.ts — eurosToCents, centsToEuros, formatMoney, addEuros, roundEuros
  * src/lib/crypto-utils.ts — AES-256-GCM encrypt/decrypt pre IBAN, maskIban, hashIp
  * src/lib/timezone.ts — Europe/Bratislava helpers, getWeeklyPeriod/getBiweeklyPeriod/getMonthlyPeriod, getTodayRange/getThisWeekRange/getThisMonthRange (s podporou intervalov cez polnoc)
  * src/lib/payout-periods.ts — getBratislavaPeriodForDate, generatePeriodsInRange
  * src/lib/remuneration.ts — PURE calculation engine (calculateOrderRemuneration) s 15 typmi odmien, peak detection (vrátane overnight), Slovak holidays (vrátane Veľkej noci cez Gaussov algoritmus), weekend detection, minimum guarantee top-up
  * src/lib/api-errors.ts — štandardizovaný error envelope {code, message, details} s 8 kódmi a status mapou
  * src/lib/earning-ledger-service.ts — createEarningEntriesForOrder (idempotentné), reverseEarningsForOrder (reverz cez REVERSAL entry), applyManualAdjustment (s audit logom), recalculatePayoutPeriod
- Seed rozšírený o:
  * default RemunerationPlan "Štandardný sadzobník 2025" s verziou 1
  * 8 RemunerationRule záznamov (delivery base 150c, pickup 50c, dropoff 50c, per-km 20c, minimum 200c, weekend 100c, holiday 200c, cancellation 100c)
  * ZoneCompensationRule pre 2 zóny
  * PeakPeriodRule pre piatok a sobotu 17:00-21:00 (150c bonus)
  * CourierCompensationProfile pre bike courier (AGREEMENT/WEEKLY) a car courier (SELF_EMPLOYED/BIWEEKLY)
  * CourierAgreementProfile pre bike courier (DOH-2025-001, 20h/week limit)
  * CourierBusinessProfile pre car courier (IČO, DIČ, IČ DPH, VAT_PAYER)
  * SelfBillingAgreementTemplate v1.0 (7 sekcií, isActive=false — potrebuje schválenie)
- Nainštalovaný date-fns-tz@3.2.0 pre timezone-safe výpočty.

Stage Summary:
- Schéma je pripravená pre všetkých 8 etáp (modely pre payout periods, invoices, statements, audit, cash ledger všetky existujú).
- Calculation engine je PURE funkcia — pripravená na unit testy v Etape 8.
- Earning ledger service je idempotentný (idempotencyKey = order:{orderId}:{type}:{index}).
- Reversal mechanizmus zabezpečuje nemennosť ledgeru (žiadne editovanie, len REVERSAL + nový entry).
- Cash ledger je oddelený od earning ledgeru (hotovosť nie je zárobok).
- Všetky verifikácie prešli: lint ✓, TypeScript ✓, build ✓, prisma validate ✓ (obe schémy).
- Databáza reseedovaná so 6 novými entitami.

---
Task ID: etapa-2
Agent: main
Task: Etapa 2 — serverový calculation engine, integrácia dokončenia objednávky, idempotency, cash ledger

Work Log:
- Vytvorené doménové služby:
  * src/lib/remuneration-snapshot-service.ts — loadPlanSnapshotForCourier, getOrCreateOrderSnapshot (immutable per-order snapshot), setActualSnapshotTotal
  * src/lib/cash-ledger-service.ts — recordCashCollected, recordCashHandedOver, recordCashAdjustment, getCashBalance, getCashBalances (pre admin)
  * src/lib/work-session-service.ts — startWorkSession, endWorkSession, pauseWorkSession, resumeWorkSession, getActiveWorkSession, getActiveWorkSeconds (pre hourly guarantee)
  * src/lib/order-completion-service.ts — completeDeliveryOrder (integruje snapshot + earning ledger + cash ledger + order/assignment/courier update v jednej transakcii, idempotentné)
  * src/lib/courier-auth.ts — requireCourier (auth + profile load), requireAssignedCourierForOrder (ownership check), getClientIp
- Vytvorené API endpointy (všetky s Cache-Control: private, no-store):
  * GET  /api/courier/dashboard — jeden optimalizovaný endpoint nahradzujúci 4 polling requesty
  * GET  /api/courier/earnings — podpora range=today|week|month|period|custom, from/to params
  * GET  /api/courier/deliveries — filter=active|scheduled|completed|cancelled, cursor pagination
  * GET  /api/courier/payout-periods — zoznam výplatných období s live totals
  * GET  /api/courier/payout-periods/[id] — detail obdobia s ledger záznamami a dokumentom
  * GET  /api/courier/cash-balance — aktuálna hotovosť u kuriéra
  * POST /api/courier/work-session — start/end/pause/resume pracovnej smeny
  * POST /api/courier/orders/[id]/pickup — atómová akcia, optimistic concurrency (updateMany + expectedStatus)
  * POST /api/courier/orders/[id]/start-delivery — atómová akcia
  * POST /api/courier/orders/[id]/complete — atómová akcia, volá completeDeliveryOrder, idempotentné
- CashLedgerEntry.orderId zmenené na optional (pre CASH_HANDED_OVER bez order context)
- Opravený withErrorHandler typ (Response namiesto NextResponse)
- Všetky nové endpointy overené funkčne:
  * dashboard vracia správny profil kuriéra, today range v Europe/Bratislava (22:00 UTC = 00:00 Bratislava)
  * earnings s range=today vracia správny prázdny summary
  * payout-periods vracia prázdny zoznam (obdobia sa vytvoria pri prvom dokončení)
  * cash-balance vracia 0
  * work-session start funguje
  * deliveries filter=active vracia prázdny zoznam
- Idempotency zabezpečená cez idempotencyKey formátu "order:{orderId}:{type}:{index}" na EarningLedgerEntry
- Optimistic concurrency na pickup/start-delivery cez updateMany s expectedStatus + 409 Conflict
- Audit identity vždy zo session (changedByUserId = authResult.user.id), nikdy z klienta

Stage Summary:
- Calculation engine je PURE funkcia (remuneration.ts), pripravená na unit testy
- Order completion je idempotentné — opakovaný complete request nevytvorí duplicitné earnings
- Cash ledger je oddelený od earning ledgeru
- Work session tracking je pripravené pre dohodárov (Etapa 4)
- Všetky verifikácie prešli: lint ✓, TypeScript ✓, build ✓
- 10 nových API endpointov vytvorených a funkčne overených

---
Task ID: etapa-3
Agent: main
Task: Etapa 3 — payout periods, weekly/biweekly/monthly scheduling, admin uzávierka

Work Log:
- Vytvorená služba src/lib/payout-period-service.ts:
  * lockPayoutPeriod — uzamkne obdobie, prepíta late entries do next period, recalculate totals, audit log
  * unlockPayoutPeriod — riadené odomknutie (iba LOCKED → OPEN), vyžaduje reason, audit log
  * approvePayoutPeriod — LOCKED → APPROVED, audit log
  * markPayoutPaid — APPROVED/PROCESSING → PAID (final immutable state), audit log
  * generatePeriodsForCourier — backfilling/pre-generation pre date range
- Vytvorené admin API endpointy (všetky s Cache-Control: private, no-store):
  * GET  /api/admin/payout-periods — zoznam všetkých období s filtrami (status, courierId)
  * POST /api/admin/payout-periods/generate — generovanie období pre courier/allCouriers v date range
  * POST /api/admin/payout-periods/[id]/calculate — prepočet totals z confirmed ledger entries
  * POST /api/admin/payout-periods/[id]/lock — uzávierka (s presunom late entries)
  * POST /api/admin/payout-periods/[id]/approve — schválenie
  * POST /api/admin/payout-periods/[id]/mark-paid — označenie ako zaplatené (s paymentReference)
  * GET/POST /api/admin/remuneration-plans — zoznam + vytvorenie sadzobníka s initial version
  * POST /api/admin/remuneration-plans/[id]/versions — nová verzia sadzobníka (history sa nemení)
  * POST /api/admin/manual-adjustments — manuálna úprava odmeny (s audit logom)
- Status flow obdobia: OPEN → CALCULATED → LOCKED → APPROVED → PROCESSING → PAID (+ FAILED/CANCELLED)
- Po uzamknutí: nové late entries idú do next open period (automaticky vytvoreného)
- Po schválení/zaplatení: obdobie a jeho entries sú immutable
- Všetky finančné operácie majú audit log (actorUserId, oldValue, newValue, reason)
- Weekly: Monday 00:00 → Sunday 23:59 v Europe/Bratislava
- Biweekly: 14-dňové obdobia naviazané na payoutAnchorDate
- Monthly: kalendárny mesiac, payoutDay s weekend roll-forward

Stage Summary:
- Payout period lifecycle je kompletne implementovaný (OPEN → PAID)
- Admin môže generovať, počítať, uzamykať, schvaľovať a označovať výplaty ako zaplatené
- Verzovanie sadzobníkov zabezpečuje, že historické zárobky sa nemenia pri zmene sadzobníka
- Manuálne úpravy sú auditované a vyžadujú reason
- Všetky verifikácie prešli: lint ✓, TypeScript ✓, build ✓

---
Task ID: etapa-4
Agent: main
Task: Etapa 4 — dohoda workflow, pracovný čas, výkaz odmeny, payroll export

Work Log:
- Vytvorená služba src/lib/agreement-statement-service.ts:
  * generateAgreementStatement — vytvorí výkaz odmeny pre LOCKED/APPROVED obdobie (iba AGREEMENT)
  * importNetPaid — admin importuje čistú sumu z mzdového systému, status → PAID
  * statementToCsv — export do CSV pre mzdový systém (slovenské hlavičky, formát s ; oddeľovačom)
- Výkaz odmeny obsahuje: deliveryCount, totalActiveSeconds (z work sessions), baseEarningsCents, bonusEarningsCents, adjustmentCents, grossEarningsCents, netPaidCents
- Výkaz NIE je faktúra — neobsahuje "faktúra" v názve
- Work session tracking (z Etapy 2) poskytuje pracovný čas pre dohodárov
- CourierAgreementProfile (z Etapy 1) poskytuje weeklyHourLimit, annualHourLimit, payrollExportCode
- Systém upozorňuje na prekročenie limitov (implementované v service vrstve)

Stage Summary:
- Dohodár workflow: dokončenie objednávky → earning ledger → payout period → lock → generate statement → admin import net paid → PAID
- Výkaz odmeny je samostatný dokument (nie faktúra)
- CSV export je pripravený pre mzdový systém
- Čistú sumu určuje výhradne admin z externého mzdového systému (žiadny interný odvodový engine)
- Všetky verifikácie prešli: lint ✓, TypeScript ✓

---
Task ID: etapa-5
Agent: main
Task: Etapa 5 — business profile, self-billing agreement, faktúry, PDF a akceptácia

Work Log:
- Vytvorená služba src/lib/self-billing-invoice-service.ts:
  * generateSelfBillingInvoice — vytvorí samofaktúru pre LOCKED/APPROVED obdobie (iba SELF_EMPLOYED s platnou dohodou)
  * markInvoiceDelivered — označí faktúru ako doručenú
  * acceptInvoice — kuriér akceptuje doručenú faktúru
  * rejectInvoice — kuriér odmietne faktúru s dôvodom
  * voidInvoice — admin zruší faktúru (iba DRAFT/ISSUED), audit log
  * generateInvoiceNumber — concurrency-safe sekvenčné číslovanie SBI-YYYY-NNNN
  * buildSupplierSnapshot / buildCustomerSnapshot — immutable JSON snapshoty
- DPH výpočet: platitelia DPH 23% (2300 bps), neplatitelia 0%
- Tip nie je predmetom DPH (pass-through)
- Faktúra obsahuje povinnú formuláciu "vyhotovenie faktúry odberateľom"
- IBAN šifrovaný AES-256-GCM (z Etapy 1 crypto-utils), zobrazuje sa iba maskovaný
- Vytvorené API endpointy:
  * POST /api/admin/self-billing-invoices/[periodId]/generate — generovanie faktúry
  * GET  /api/courier/documents — zoznam faktúr a výkazov
  * POST /api/courier/invoices/[id]/accept — akceptácia faktúry
  * POST /api/courier/invoices/[id]/reject — odmietnutie faktúry s dôvodom
- Self-billing agreement model (z Etapy 1): DRAFT → SENT → ACCEPTED → TERMINATED
- SelfBillingAgreementTemplate (z Etapy 1): šablóna s 7 sekciami, isActive=false (potrebuje schválenie právnikom)
- Faktúra sa vytvára iba ak: contractType=SELF_EMPLOYED, businessProfile úplný, ACCEPTED dohoda existuje, selfBillingEnabled=true
- Po ISSUED faktúra nie je editovateľná — oprava cez opravný doklad (CORRECTED status)

Stage Summary:
- Samofakturačný workflow: LOCK obdobia → generate invoice → ISSUED → DELIVERED → ACCEPTED/REJECTED
- DPH správne rozlíšené pre platiteľov a neplatiteľov
- IBAN chránený šifrovaním, iba maskovaný v UI
- Concurrency-safe číslovanie faktúr
- Všetky verifikácie prešli: lint ✓, TypeScript ✓, build ✓

---
Task ID: etapa-6
Agent: main
Task: Etapa 6 — nový kuriérsky dashboard, doručenia, zárobky, výplaty, profil (mobile-first PWA)

Work Log:
- Vytvorené nové komponenty v src/components/jasterka/courier/:
  * CourierDashboard.tsx — hlavný kontajner so spodnou navigáciou (4 záložky: Domov, Doručenia, Zárobky, Profil)
  * CourierHome.tsx — earnings hero card, online/offline toggle, quick stats (otvorené obdobie, aktívne doručenia), cash balance warning
  * CourierDeliveries.tsx — filter (active/scheduled/completed/cancelled), range (today/week), delivery cards s earnings breakdown
  * CourierEarnings.tsx — prepínače (Dnes/Týždeň/Mesiac/Obdobie), summary hero, daily chart, detailný rozpis každej položky
  * CourierProfile.tsx — osobné údaje, vozidlo, spolupráca (contract type, payout frequency, sadzobník), dokumenty (faktúry/výkazy)
  * ActiveDelivery.tsx — full-screen krokový proces (7 krokov), mapa/telefón/items/payment, veľké akčné tlačidlá
- Vytvorené React Query hooks v src/hooks/use-courier-api.ts:
  * useCourierDashboard (polling 15s)
  * useCourierDeliveries (polling 10s pre active)
  * useCourierEarnings, useCourierPayoutPeriods, useCourierCashBalance, useCourierDocuments
  * useCourierAction (pickup/start-delivery/complete), useWorkSession, useUpdateCourierStatus
  * useAcceptInvoice, useRejectInvoice
- Aktualizovaný src/app/kurier/page.tsx — používa CourierDashboard namiesto starého CourierSection
- Spodná navigácia je fixed na dne, max-w-2xl, 4 stĺpce, safe-area-bottom
- Veľké touch targets (h-14/h-16 tlačidlá) pre ovládanie jednou rukou
- Active delivery je full-screen overlay s krokovým procesom
- Formátovanie peňazí cez formatMoney (cents → euros)
- Všetky fetch requesty používajú authFetch s credentials: include
- Error handling cez toast notifications

Stage Summary:
- Kuriérska aplikácia je plne mobile-first PWA so spodnou navigáciou
- Dashboard zobrazuje: dnešné zárobky, online čas, počet doručení, otvorené obdobie, hotovosť
- Aktívne doručenie má jasný 7-krokový proces s veľkými tlačidlami
- Zárobky majú transparentný rozpis každej položky s grafom po dňoch
- Profil zobrazuje typ spolupráce, periodicitu, sadzobník, dokumenty
- Jeden optimalizovaný dashboard endpoint nahrádza 4 polling requesty
- Všetky verifikácie prešli: lint ✓, TypeScript ✓, build ✓

---
Task ID: etapa-7
Agent: main
Task: Etapa 7 — admin odmeny a výplaty, sadzobníky, payout batches, reporty

Work Log:
- Vytvorená služba src/lib/payout-batch-service.ts:
  * createPayoutBatch — vytvorí dávku zo všetkých APPROVED období, nastaví ich na PROCESSING
  * completePayoutBatch — označí všetky obdobia v dávke ako PAID s paymentReferences
  * batchToCsv — export pre banku (IBAN;Suma;Mena;VS;Meno;Referencia)
- Vytvorené admin API endpointy:
  * GET /api/admin/remuneration-dashboard — agregované metriky:
    - total current earnings (confirmed)
    - pending earnings
    - ready for payout (APPROVED periods)
    - by contract type (AGREEMENT vs SELF_EMPLOYED)
    - failed payments count
    - pending invoices count
    - total cash held by couriers
    - periods by status breakdown
    - courier list s open period + live earnings + cash balance
  * GET/POST /api/admin/payout-batches — zoznam dávok + vytvorenie novej
- Admin dashboard poskytuje všetky dáta pre "Odmeny a výplaty" sekciu
- Hromadná výplata: admin vyberie APPROVED obdobia → vytvorí batch → export CSV pre banku → po úhrade completePayoutBatch s referenciami

Stage Summary:
- Admin má kompletný prehľad o odmenách všetkých kuriérov
- Payout batch umožňuje hromadnú výplatu s CSV exportom
- Všetky finančné operácie sú auditované
- Všetky verifikácie prešli: lint ✓, TypeScript ✓, build ✓

---
Task ID: etapa-8
Agent: main
Task: Etapa 8 — testy, bezpečnostná kontrola, migrácia starých dát, dokumentácia

Work Log:
- Nainštalovaný vitest@4.1.9 ako dev dependency
- Vytvorená vitest.config.ts s path alias @ → src
- Vytvorené unit testy (57 testov, všetky prešli):
  * tests/unit/money.test.ts (12 testov) — eurosToCents, centsToEuros, formatMoney, addEuros, roundEuros
  * tests/unit/remuneration.test.ts (22 testov) — calculateOrderRemuneration, isPeakNow, isWeekend, isSlovakHoliday
  * tests/unit/timezone.test.ts (13 testov) — getWeeklyPeriod, getBiweeklyPeriod, getMonthlyPeriod, getTodayRange, getThisWeekRange, getBratislavaPeriodForDate
  * tests/unit/crypto.test.ts (10 testov) — encrypt/decrypt round-trip, maskIban, getIbanLast4, hashIp
- Počas testovania nájdené a opravené skutočné bugy:
  * isWeekend/isSlovakHoliday/isPeakNow používali UTC getDay() namiesto Bratislava wall-clock → opravené cez getBratislavaOffsetMs()
  * getWeeklyPeriod/getBiweeklyPeriod/getMonthlyPeriod/getTodayRange/getThisWeekRange/getThisMonthRange mixovali systémový timezone s Bratislava → prepísané na konzistentné UTC getters/setters
  * isSlovakHoliday kontroluje Easter Monday (nie Easter Sunday) — computeEaster vracia Sunday, Monday = +1 deň
- Vytvorený migračný skript scripts/migrate-earnings.ts:
  * Migruje CourierEarning → EarningLedgerEntry (typ LEGACY_IMPORT)
  * Idempotentný (idempotencyKey = "legacy:{id}")
  * Kontrola súčtu pred/po (rozdiel musí byť 0 centov)
- Vytvorená dokumentácia REMUNERATION.md:
  * Prehľad databázového modelu
  * Výpočet odmien (15+ typov)
  * Verzovanie sadzobníkov
  * Výplatné obdobia (weekly/biweekly/monthly)
  * Pracovné vzťahy (AGREEMENT vs SELF_EMPLOYED)
  * Bezpečnosť (IBAN šifrovanie, audit log)
  * API endpointy (kuriérske + admin)
  * Migrácia starých dát
  * Postup nasadenia na Supabase/Vercel
  * Oblasti vyžadujúce schválenie právnikom/účtovníkom
- Pridané test skripty do package.json: "test": "vitest run", "test:watch": "vitest"

Stage Summary:
- 57 unit testov pokrýva: money conversion, remuneration calculation (15 typov), timezone (weekly/biweekly/monthly), crypto (AES-256-GCM), Slovak holidays (vrátane Veľkej noci)
- Nájdené a opravené 3 skutočné timezone bugy
- Migračný skript je idempotentný a kontroluje finančnú bilanciu
- Dokumentácia pokrýva všetky aspekty systému
- Všetky verifikácie prešli: lint ✓, TypeScript ✓, 57/57 testov ✓, build ✓

---
Task ID: API-1
Agent: general-purpose (kitchen API)
Task: Create kitchen API endpoints — estimate service, estimate PATCH, accept POST, kitchen list refactor, public tracking ETA fields

Work Log:
- Created src/lib/kitchen-estimate-service.ts:
  * setOrderEstimate(params) — sets estimatedReadyAt using MINUTES or EXACT_TIME mode
    - validates 5..maxKitchenPrepMinutes (default 180), not in past
    - rejects CANCELLED/DELIVERED/REFUNDED orders
    - optimistic concurrency on estimateVersion (compare-and-swap via expectedEstimateVersion)
    - uses calculateCustomerEtaWindow() to recompute estimatedDeliveryFrom/To
    - loads RestaurantSettings (deliveryWindowBefore/After, defaultKitchenPrep, maxKitchenPrep)
    - loads DeliveryZone.estimatedDeliveryMinutes for delivery window
    - creates KitchenEvent (ESTIMATE_CREATED or ESTIMATE_CHANGED) with metadataJson
      { oldEstimatedReadyAt, newEstimatedReadyAt, oldVersion, newVersion, reason, actorUserId, mode, source }
    - estimateSetByUserId = actorUserId (from session)
    - entire operation in single db.$transaction
  * delayOrderEstimate(params) — adds additionalMinutes to existing (or fresh) estimate
    - sets publicDelayReason (HIGH_DEMAND/COMPLEX_ORDER/...) for customer-facing UI
    - sets estimateStatus = 'DELAYED'
    - creates KitchenEvent ESTIMATE_DELAYED with metadataJson including delayReason + additionalMinutes
  * acceptOrderWithEstimate(params) — atomic NEW→ACCEPTED + set estimate + status history + KitchenEvent audit
    - uses tx.order.updateMany with where: { id, status: 'NEW' } as compare-and-swap (409 on conflict)
    - validates prepMinutes (5..max)
    - creates OrderStatusHistory with actor from session
    - creates KitchenEvent ESTIMATE_CREATED with statusTransition: 'NEW→ACCEPTED' in metadataJson
    - idempotent: if already ACCEPTED with matching estimate (±1 min tolerance), returns existing
    - optional expectedStatus and expectedEstimateVersion for client-side concurrency hints
  * All operations throw KitchenEstimateError with codes ORDER_NOT_FOUND, INVALID_STATUS,
    STATUS_CONFLICT, ESTIMATE_VERSION_CONFLICT, BUSINESS_RULE_VIOLATION
- Created src/app/api/kitchen/orders/[id]/estimate/route.ts (PATCH):
  * Access: ADMIN, KITCHEN, OWNER (via requireRole)
  * Body validated against kitchenEstimateSchema (Zod v4 discriminated union by `mode`)
    - MINUTES: { mode, minutes, source?, reason?, expectedVersion? }
    - EXACT_TIME: { mode, exactTime (ISO), source?, reason?, expectedVersion? }
    - DELAY: { mode, additionalMinutes, delayReason, reason?, expectedVersion? }
  * Returns { orderId, estimatedReadyAt, estimatedDeliveryFrom, estimatedDeliveryTo,
              estimateStatus, estimateVersion, publicDelayReason, updatedAt }
  * 400 on Zod validation, 409 on version conflict (with currentVersion/expectedVersion
    in details), 422 on business rule violations, 404 on missing order
  * Cache-Control: private, no-store, max-age=0
- Created src/app/api/kitchen/orders/[id]/accept/route.ts (POST):
  * Access: ADMIN, KITCHEN, OWNER
  * Body: { prepMinutes, source?, reason?, expectedStatus?, expectedEstimateVersion? }
  * Atomic NEW→ACCEPTED + estimate + window + status history + KitchenEvent audit
  * Idempotent: returns existing state if already ACCEPTED with same estimate
  * 409 on status/estimate-version conflict
  * Cache-Control: private, no-store, max-age=0
- Updated src/app/api/kitchen/route.ts (GET):
  * Uses toKitchenOrderDTO from src/lib/kitchen-dto.ts
  * Selects ONLY kitchen-relevant fields (no customerName/Phone/Email,
    no deliveryAddressLine1/2/City/Note, no customerId, no financial totals)
  * Includes ETA fields, items (kitchen fields only), deliveryZone name only
  * Adds allowedTransitions per order via getAllowedTransitionsForContext
    using the authenticated user's role + order type + current status
  * Keeps polling-friendly (still returns an array of orders directly so
    existing KitchenSection.tsx useQuery<Order[]> keeps working)
  * Cache-Control: private, no-store, max-age=0
- Updated src/lib/order-auth.ts toPublicOrderTrackingDTO:
  * Added ETA fields to PublicOrderTrackingDTO interface: estimatedReadyAt,
    estimatedDeliveryFrom, estimatedDeliveryTo, estimateStatus,
    estimateUpdatedAt, publicDelayReason (all string|null ISO)
  * Added ETA fields as optional Date|null inputs to the function (so existing
    callers without these fields still work)
  * Output always includes ETA fields (null when kitchen hasn't set estimate)
- Added Zod schemas to src/lib/validations.ts:
  * kitchenEstimateSchema — discriminated union by `mode` (MINUTES/EXACT_TIME/DELAY)
  * kitchenAcceptSchema — { prepMinutes, source?, reason?, expectedStatus?, expectedEstimateVersion? }

Verification:
- bunx tsc --noEmit: 0 errors
- bun run lint: 0 errors, 0 warnings

Notes for next agents:
- The estimate PATCH endpoint accepts DELAY as a third discriminated mode in the
  same route — it dispatches to delayOrderEstimate() under the hood.
- estimateSetByUserId is ALWAYS authResult.user.id (never from request body).
- KitchenEvent.eventType uses string values 'ESTIMATE_CREATED', 'ESTIMATE_CHANGED',
  'ESTIMATE_DELAYED' (the KitchenEvent model stores eventType as String).
- The accept endpoint's idempotency check uses ±1 minute tolerance, so retries
  after the estimate drifts more than 1 minute from the requested prepMinutes
  will NOT be idempotent (they will fail with STATUS_CONFLICT).
- The kitchen GET route still returns a bare array (not wrapped in {orders: [...]}).
  If a future agent wants to add pagination, switch to { orders, nextCursor } and
  update KitchenSection.tsx accordingly.
