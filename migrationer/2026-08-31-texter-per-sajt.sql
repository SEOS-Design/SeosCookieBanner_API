-- ============================================================================
-- C1 steg 3: texter per sajt
-- ============================================================================
--
-- Körs i Neon SQL Editor, INTE med drizzle-kit push. Ta en branch-snapshot
-- först — det är sekunder och det är enda vägen tillbaka.
--
-- EN ENDA OMGÅNG, till skillnad från steg 1 och steg 2. De hade ett andra steg
-- som ändrade vad en kunds besökare ser. Det har inte det här: att fylla i en
-- text görs per sajt när någon vill det, långt efter migreringen, och backas
-- genom att tömma fältet.
--
-- SKILLNAD MOT STEG 1, värd att känna till: designvärdena sätts som INLINE
-- STYLE och slog därför igenom hos kunden i samma sekund som de fanns i
-- databasen. Texter beter sig som kategorierna gjorde i steg 2: en banner som
-- inte läser fältet ignorerar det helt enkelt. Ordningen är därför fri, och
-- API:t kan gå ut före bannern.


-- ---------------------------------------------------------------------------
-- LÄGG TILL KOLUMNEN. Ofarligt.
-- ---------------------------------------------------------------------------
--
-- Tomt objekt som standard betyder att varje sajt kör bannerns egna texter.
-- Så länge alla rader är tomma beter sig systemet exakt som före steg 3, även
-- med både API och banner ute. Ingen rad behöver röras för att rulla ut.

ALTER TABLE websites
  ADD COLUMN IF NOT EXISTS texts jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Kontroll: alla tre sajterna ska ha ett tomt objekt.
--   SELECT domain, texts FROM websites ORDER BY domain;


-- ---------------------------------------------------------------------------
-- FORMEN PÅ INNEHÅLLET
-- ---------------------------------------------------------------------------
--
-- Nycklat på språk ytterst, sedan kategori, sedan fält:
--
--   {
--     "sv": {
--       "marketing": {
--         "label": "Marknadsföring",
--         "description": "Används för att visa relevanta annonser.",
--         "notice": "Den här webbplatsen använder inga marknadsföringscookies."
--       }
--     }
--   }
--
-- Tre fält per kategori:
--   label        rubriken på kortet
--   description  texten under rubriken när kategorin ANVÄNDS
--   notice       texten under rubriken när sajten INTE använder den
--
-- ALLT ÄR VALFRITT, hela vägen ner. Ett fält som saknas hämtas ur bannerns
-- egen språktabell. En sajt kan alltså byta ordalydelse på en enda rubrik och
-- låta allt annat vara.
--
-- SPRÅK: fyll bara i det sajten faktiskt använder. Alla tre sajterna kör
-- svenska idag, så "sv" räcker. En besökare i engelskt språkläge får bannerns
-- inbyggda engelska — inte skräddarsytt, men aldrig tomt.
--
-- ⚠️ REN TEXT, ALDRIG HTML. Bannern skriver de här värdena med textContent,
-- alltså som bokstäver. Skriver någon <strong>Analys</strong> i databasen
-- visas taggarna för besökaren i stället för att tolkas. Det är med flit: det
-- är hela skälet till att steg 3 inte öppnar något XSS-hål. Se specen i
-- COOKIEBANNER-DOKUMENTATION.md, avsnitt C.
--
-- DATABASEN VALIDERAR INTE INNEHÅLLET. Samma val som för design-kolumnen, och
-- av samma skäl — listan över fält kommer att växa, och varje nytt fält hade
-- annars varit en schemaändring i produktion. API:t filtrerar i stället mot en
-- tillåten lista över kategorinycklar och fältnamn, och släpper bara igenom
-- det den känner igen. Okända nycklar försvinner tyst i stället för att gå ut
-- till besökare.


-- ---------------------------------------------------------------------------
-- ATT FYLLA I EN TEXT — GÖRS INTE HÄR
-- ---------------------------------------------------------------------------
--
-- Först när bannern som läser fältet ligger ute, och en sajt i taget.
--
-- ⚠️ Hur ifyllningen ska gå till är ÄNNU INTE BESTÄMT. Två vägar, och valet
-- hör ihop med hur policyerna och designen redan fungerar:
--
--   (a) SQL direkt mot databasen. Enklast, men då finns texten bara där —
--       ingen historik, ingen diff att granska, inget sätt att se hur en kunds
--       banner är tänkt att låta.
--   (b) En fil i repot plus ett publiceringskommando, som design/ och
--       policies/. FILEN ÄR SANNINGEN, DATABASEN ÄR KOPIAN. Det mönstret
--       valdes en gång av ett konkret skäl: den svenska policytexten låg bara
--       i databasen, och seed-skriptet hade kvar gammal engelsk text.
--
-- Kolumnen ser likadan ut oavsett vilket, så migreringen väntar inte på svaret.


-- ---------------------------------------------------------------------------
-- ÅNGRA
-- ---------------------------------------------------------------------------
--
-- Ser en text fel ut: töm sajtens fält, så faller den tillbaka på bannerns
-- egna texter. Slår igenom när CDN-cachen gått ut, högst 6 timmar — eller
-- direkt om API:t redeployas.
--
--   UPDATE websites SET texts = '{}'::jsonb WHERE domain = 'www.brevenshus.se';
--
-- Vill man backa hela steget:
--   ALTER TABLE websites DROP COLUMN texts;
--
-- ⚠️ Att droppa den här kolumnen är ofarligt, till skillnad från att radera en
-- rad i consent_category. Ingenting pekar hit, och innehållet är presentation
-- — inte bevis.
