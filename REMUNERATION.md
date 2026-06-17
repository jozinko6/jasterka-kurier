# Systém odmien a výplat — Pizza Jašterka

## Prehľad

Tento dokument popisuje architektúru systému výpočtu odmien, evidencie zárobkov, výplatných období, samofakturácie a administrácie sadzieb.

## Databázový model

### Finančné hodnoty

Všetky peniažné hodnoty sú uložené ako **integer cents** (`Int`), nie ako `Float`. Konverzia medzi eurami a centami:

```typescript
import { eurosToCents, centsToEuros, formatMoney } from '@/lib/money'

eurosToCents(9.90)    // → 990
centsToEuros(990)     // → 9.90
formatMoney(9.90)     // → "9,90 €"
```

### Hlavné modely

| Model | Účel |
|-------|------|
| `RemunerationPlan` | Verzovaný sadzobník odmien |
| `RemunerationPlanVersion` | Konkrétne vydanie sadzobníka (immutable) |
| `RemunerationRule` | Pravidlo výpočtu (typ, hodnota, podmienky) |
| `CourierRateOverride` | Individuálna výnimka pre kuriéra |
| `ZoneCompensationRule` | Bonus pre konkrétnu zónu |
| `PeakPeriodRule` | Bonus za špičku (deň + čas) |
| `OrderRemunerationSnapshot` | Immutable snapshot pravidiel pre objednávku |
| `EarningLedgerEntry` | Nemenná účtovná kniha zárobkov |
| `CashLedgerEntry` | Hotovosť vybraná od zákazníkov (oddelené) |
| `WorkSession` | Pracovný čas kuriéra |
| `PayoutPeriod` | Výplatné obdobie (OPEN → PAID) |
| `PayoutBatch` | Hromadná výplata |
| `SelfBillingAgreement` | Dohoda o samofakturácii |
| `SelfBillingInvoice` | Samofaktúra |
| `AgreementEarningsStatement` | Výkaz odmeny dohodára |
| `CourierCompensationProfile` | Typ spolupráce + periodicita + sadzobník |
| `CourierBusinessProfile` | Firemné údaje živnostníka (IBAN šifrovaný) |
| `CourierAuditLog` | Audit všetkých finančných operácií |

## Výpočet odmien

Calculation engine je PURE funkcia v `src/lib/remuneration.ts`:

```typescript
const result = calculateOrderRemuneration(planSnapshot, orderInput)
// result.components = [{ type: 'DELIVERY_BASE', amountCents: 150, ... }, ...]
// result.totalCents = 350
```

### Typy odmien

- `DELIVERY_BASE` — základná odmena za doručenie
- `PICKUP_FEE` — odmena za vyzdvihnutie
- `DROPOFF_FEE` — odmena za odovzdanie
- `PICKUP_DISTANCE` — vzdialenosť kuriéra k prevádzke
- `DELIVERY_DISTANCE` — vzdialenosť k zákazníkovi
- `ZONE_BONUS` — bonus za zónu
- `PEAK_BONUS` — bonus za špičku
- `WEEKEND_BONUS` — víkendový bonus
- `HOLIDAY_BONUS` — sviatočný bonus
- `WEATHER_BONUS` — bonus za zlé počasie
- `MULTI_ORDER_BONUS` — bonus za viac objednávok v trase
- `CANCELLATION_COMPENSATION` — storno kompenzácia
- `TIP` — prepitné
- `MINIMUM_PER_ORDER` — minimálna garantovaná odmena
- `MANUAL_BONUS` / `MANUAL_ADJUSTMENT` — manuálne úpravy
- `REVERSAL` — reverzný záznam (oprava)
- `LEGACY_IMPORT` — import zo starého modelu

### Verzovanie sadzobníkov

Pri zmene sadzobníka sa vytvorí nová `RemunerationPlanVersion`. Historické zárobky sa **nikdy** neprepočítavajú — používajú snapshot verzie, ktorá bola platná v čase vzniku zárobku.

## Výplatné obdobia

### Periodicita

- **WEEKLY** — pondelok 00:00 až nedeľa 23:59 (Europe/Bratislava)
- **BIWEEKLY** — 14-dňové obdobia naviazané na `payoutAnchorDate`
- **MONTHLY** — kalendárny mesiac, deň výplaty s weekend roll-forward

Všetky výpočty sú v časovom pásme **Europe/Bratislava** (CET/CEST s DST).

### Stavy obdobia

```
OPEN → CALCULATED → LOCKED → APPROVED → PROCESSING → PAID
                                                    ↘ FAILED
CANCELLED
```

Po uzamknutí (LOCKED) sa nové neskoré záznamy presúvajú do nasledujúceho obdobia. Po zaplatení (PAID) je obdobie immutable.

## Pracovné vzťahy

### AGREEMENT (dohoda)

- Nevystavuje sa faktúra
- Vytvára sa `AgreementEarningsStatement` (výkaz odmeny)
- Eviduje sa pracovný čas cez `WorkSession`
- Admin importuje čistú sumu z mzdového systému
- CSV export pre mzdový systém

### SELF_EMPLOYED (živnosť)

- Vyžaduje `CourierBusinessProfile` s IČO, DIČ, IBAN
- Vyžaduje platnú `SelfBillingAgreement` (ACCEPTED status)
- Vytvára sa `SelfBillingInvoice` (samofaktúra)
- DPH výpočet podľa `vatStatus` (VAT_PAYER 23%, NOT_REGISTERED 0%)
- Faktúra obsahuje "vyhotovenie faktúry odberateľom"

## Bezpečnosť

### IBAN šifrovanie

IBAN je šifrovaný AES-256-GCM (`src/lib/crypto-utils.ts`). V databáze je uložený `ibanEncrypted` (ciphertext) a `ibanLast4` (plaintext posledné 4 znaky). V UI sa zobrazuje iba maskovaná hodnota.

Produkcia MÁ nastaviť `ENCRYPTION_KEY` environment variable (32-byte hex alebo base64).

### Audit log

Všetky finančné operácie sú auditované v `CourierAuditLog`:
- zmena typu spolupráce
- zmena periodicity
- zmena sadzobníka
- manuálna úprava odmeny
- uzamknutie/odomknutie obdobia
- schválenie výplaty
- označenie výplaty ako zaplatenej
- zmenu IBAN
- vytvorenie/zrušenie faktúry

## API endpointy

### Kuriérske

```
GET  /api/courier/dashboard              — jeden optimalizovaný endpoint
GET  /api/courier/deliveries             — filter + pagination
GET  /api/courier/earnings               — range + summary + chart
GET  /api/courier/payout-periods         — zoznam období
GET  /api/courier/payout-periods/[id]    — detail obdobia
GET  /api/courier/cash-balance           — hotovosť u kuriéra
GET  /api/courier/documents              — faktúry + výkazy
POST /api/courier/work-session           — start/end/pause/resume
POST /api/courier/orders/[id]/pickup     — atómová akcia
POST /api/courier/orders/[id]/start-delivery
POST /api/courier/orders/[id]/complete   — idempotentné
POST /api/courier/invoices/[id]/accept
POST /api/courier/invoices/[id]/reject
```

### Admin

```
GET  /api/admin/remuneration-dashboard   — agregované metriky
GET  /api/admin/payout-periods
POST /api/admin/payout-periods/generate
POST /api/admin/payout-periods/[id]/calculate
POST /api/admin/payout-periods/[id]/lock
POST /api/admin/payout-periods/[id]/approve
POST /api/admin/payout-periods/[id]/mark-paid
GET/POST /api/admin/remuneration-plans
POST /api/admin/remuneration-plans/[id]/versions
POST /api/admin/self-billing-invoices/[periodId]/generate
POST /api/admin/manual-adjustments
GET/POST /api/admin/payout-batches
```

## Migrácia starých dát

```bash
bunx tsx scripts/migrate-earnings.ts
```

Skript migruje `CourierEarning` záznamy do `EarningLedgerEntry` s typom `LEGACY_IMPORT`. Je idempotentný — opätovné spustenie nevytvára duplikáty. Po migrácii sa kontroluje, či súčet pred a po je rovnaký (0 centov rozdiel).

## Postup nasadenia na Supabase/Vercel

### 1. Databáza (Supabase)

```bash
# Nastavte DATABASE_URL a DIRECT_URL v .env
export DATABASE_URL="postgresql://postgres.hdtnpmpfwwrvcunwvbpd:[password]@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
export DIRECT_URL="postgresql://postgres:[password]@db.hdtnpmpfwwrvcunwvbpd.supabase.co:5432/postgres"

# Aplikujte migrácie
prisma migrate deploy --schema=prisma/schema.prisma
```

### 2. Aplikácia (Vercel)

```bash
# Nastavte environment variables vo Vercel:
# - DATABASE_URL (Supabase pooler)
# - DIRECT_URL (Supabase direct)
# - ENCRYPTION_KEY (32-byte hex pre IBAN šifrovanie)

# Build
vercel-build
```

### 3. Produkčný bootstrap

```bash
# Vytvorte admin účet bezpečne (nepoužívajte seed v produkcii)
# Nastavte ADMIN_BOOTSTRAP_PASSWORD env var a spustite:
bunx tsx scripts/create-admin.ts
```

## Oblasti vyžadujúce schválenie pred produkciou

⚠️ **Právnik/účtovník musí potvrdiť:**

1. Text `SelfBillingAgreementTemplate` (momentálne `isActive=false`)
2. formulácia "vyhotovenie faktúry odberateľom" na samofaktúre
3. DPH sadzby (23% standard, 0% pre neplatiteľov)
4. Limity pre dohodárov (weeklyHourLimit, annualHourLimit)
5. Postup importu čistej sumy z mzdového systému
6. Lehota na námietky voči faktúre (7 dní)
7. Spôsob ukončenia dohody o samofakturácii (30 dní)

⚠️ **Bezpečnosť:**

1. `ENCRYPTION_KEY` musí byť nastavený v produkcii
2. `NEXTAUTH_SECRET` odstrániť ak sa nepoužíva next-auth
3. Seed skript nesmie byť spustiteľný v produkcii (produkčný bootstrap cez env var)
4. Service workery necachujú autentifikované API odpovede
