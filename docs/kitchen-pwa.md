# Kitchen PWA

## Inštalácia

1. Otvorte `/kuchyna` v prehliadači (Chrome, Samsung Internet, Safari)
2. Prihláste sa kuchynským účtom
3. Pridajte na domovskú obrazovku:
   - Chrome: menu → "Pridať na domovskú obrazovku"
   - Safari: zdieľať → "Pridať na domovskú obrazovku"
4. Spustite z ikony — otvorí sa v standalone režime

## Podporované zariadenia

- Android Chrome (PWA s service workerom)
- Samsung Internet
- iOS/iPadOS Safari (PWA s obmedzeniami)
- Desktop Chrome/Edge (inštalovateľné)

## Funkcie

### Stále zapnutá obrazovka
- Kliknite na ikonu slnka v hlavičke
- Používa Screen Wake Lock API
- Re-acquires pri návrate do aplikácie
- Ak nie je podporované, tlačidlo sa nezobrazí

### Zvukové upozornenia
- Nové objednávky spustia krátky zvuk a vibráciu
- Zap/vypnúť cez ikonu reproduktora v hlavičke
- Zvuk sa neprehráva pri každom pollingu tej istej objednávky

### Offline režim
- Červený banner "Ste offline" pri strate pripojenia
- Mutačné tlačidlá sú zablokované
- Po obnovení pripojenia sa dáta automaticky obnovia
- Service worker necachuje žiadne API odpovede

## Rozloženie

### Mobil (< 768px)
- Vertikálna fronta objednávok
- Horné záložky stavov s počtami
- Veľké karty s dotykovými tlačidlami (56px hlavné, 48px sekundárne)

### Tablet na šírku (≥ 768px)
- 2-3 stĺpce kariet
- Sticky filtre a hlavička

### Tablet na šírku (≥ 1280px)
- 3 stĺpce kariet

## Nastavenie času prípravy

### Rýchly výber
1. Na karte novej objednávky kliknite "Prijať a nastaviť čas"
2. Vyberte jeden z presetov: 15, 20, 25, 30, 40, 45 minút
3. Potvrďte — objednávka je prijatá s nastaveným časom

### Vlastný čas
1. V dialógu prijatia zadajte vlastný počet minút
2. Alebo v detaile objednávky použite pole "Vlastné minúty"

### Pridanie meškania
- Na karte: tlačidlá +5, +10, +15 minút
- V detaile: rovnaké tlačidlá + vlastné minúty
- Pri meškaní sa automaticky nastaví dôvod (HIGH_DEMAND)

## Priorita radenia

Objednávky sú automaticky radené podľa priority:
1. Meškajúce (červeno označené)
2. Nové neprijaté (modro označené)
3. Blížiace sa k odhadovanému času (žlto)
4. Dlho čakajúce
5. Ostatné
