# Order Estimates

## Prehľad

Systém časových odhadov pozostáva z:

1. **Kitchen estimate** — kuchyňa nastaví predpokladaný čas pripravenia
2. **Delivery window** — systém vypočíta časové okno doručenia z času pripravenia + zóny
3. **Customer tracking** — zákazník vidí bezpečné ETA údaje

## Databázové polia

| Pole | Typ | Popis |
|------|-----|-------|
| `estimatedReadyAt` | DateTime? | Predpokladaný čas pripravenia (UTC) |
| `estimatedDeliveryFrom` | DateTime? | Začiatok okna doručenia (UTC) |
| `estimatedDeliveryTo` | DateTime? | Koniec okna doručenia (UTC) |
| `estimateSetAt` | DateTime? | Kedy bol odhad prvýkrát nastavený |
| `estimateUpdatedAt` | DateTime? | Kedy bol odhad naposledy zmenený |
| `estimateSetByUserId` | String? | ID používateľa (zo session, nikdy z klienta) |
| `estimateVersion` | Int | Verzia odhadu pre optimistic concurrency |
| `estimateSource` | EstimateSource? | Kto nastavil odhad |
| `estimateStatus` | EstimateStatus? | Stav odhadu |
| `publicDelayReason` | PublicDelayReason? | Verejný dôvod meškania |

## Výpočet delivery window

```
estimatedReadyAt + zone.estimatedDeliveryMinutes = estimatedDelivery
estimatedDelivery - settings.deliveryWindowBeforeMinutes = deliveryFrom
estimatedDelivery + settings.deliveryWindowAfterMinutes = deliveryTo
```

Príklad:
- Kuchyňa nastaví 18:35
- Zóna má 20 minút doručenie
- Tolerancia -5/+10 minút
- Výsledok: 18:50 – 19:05

Pre PICKUP sa delivery window nepočíta.

## API endpointy

### PATCH /api/kitchen/orders/[id]/estimate
Nastavenie alebo zmena času prípravy.

Módy:
- `MINUTES` — pridá N minút k aktuálnemu času
- `EXACT_TIME` — konkrétny čas (UTC ISO)
- `DELAY` — pridá N minút k existujúcemu odhadu + dôvod

Optimistic concurrency: `expectedVersion` sa porovnáva s `estimateVersion` v databáze.

### POST /api/kitchen/orders/[id]/accept
Atómové prijatie objednávky s nastavením času.

V jednej transakcii:
1. NEW → ACCEPTED (compare-and-swap)
2. Nastavenie estimatedReadyAt
3. Výpočet delivery window
4. Status history
5. KitchenEvent audit

## Audit

Každá zmena odhadu vytvorí `KitchenEvent`:
- `ESTIMATE_CREATED` — prvý odhad
- `ESTIMATE_CHANGED` — zmena existujúceho odhadu
- `ESTIMATE_DELAYED` — pridanie meškania

`metadataJson` obsahuje:
```json
{
  "oldEstimatedReadyAt": "2025-06-18T16:35:00Z",
  "newEstimatedReadyAt": "2025-06-18T16:50:00Z",
  "oldVersion": 2,
  "newVersion": 3,
  "reason": "HIGH_DEMAND",
  "actorUserId": "user-123"
}
```

## Zákaznícke zobrazenie

Zákazník vidí:
- Predpokladané pripravenie (HH:mm)
- Predpokladané doručenie (HH:mm – HH:mm) pre DELIVERY
- Stav odhadu (čaká na kuchyňu / nastavený / meškanie / pripravené)
- Dôvod meškania (verejný, používateľsky prívetivý text)

Nikdy nevidí:
- ID používateľa kuchyne
- Interné poznámky
- Auditný log
- Presnú príčinu (ak je interná)
