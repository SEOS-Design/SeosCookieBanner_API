-- ============================================================================
-- C1 steg 1: designvarden per sajt
-- ============================================================================
--
-- Korrs i Neon SQL Editor, INTE med drizzle-kit push. Ta en branch-snapshot
-- forst - det ar sekunder och det ar enda vagen tillbaka.
--
-- Korrs i TVA omgangar med verifiering emellan. Steg 1 ar ofarligt och kan
-- koras nar som helst. Steg 2 andrar hur en KUNDS banner ser ut och ska koras
-- forst nar bannern som laser kolumnen ligger ute.
--
-- ORDNINGEN SPELAR ROLL, och skalet ar inte uppenbart: bannern satter
-- designvardena som INLINE STYLE pa vardelementet, och inline vinner over
-- kundens designblock i deras <head>. Ett fel varde i databasen slar alltsa
-- igenom direkt hos kunden - det tystas inte av deras egna regler.


-- ---------------------------------------------------------------------------
-- STEG 1 - lagg till kolumnen. Ofarligt.
-- ---------------------------------------------------------------------------
--
-- Tomt objekt som standard betyder att varje sajt kor bannerns standardvarden.
-- Sa lange alla rader ar tomma beter sig systemet exakt som fore C1, aven med
-- den nya bannern ute. Det gor utrullningen omvandbar utan att rora databasen.

ALTER TABLE websites
  ADD COLUMN IF NOT EXISTS design jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Kontroll: alla tre sajterna ska ha ett tomt objekt.
--   SELECT domain, design FROM websites ORDER BY domain;


-- ---------------------------------------------------------------------------
-- STEG 2 - flytta in brevenshus designvarden
-- ---------------------------------------------------------------------------
--
-- GORS INTE HAR, utan med publiceringskommandot:
--
--   npm run publish-design -- --site=brevenshus          (torrkorning)
--   npm run publish-design -- --site=brevenshus --run    (skarpt)
--
-- Vardena ligger i design/brevenshus.css som vanlig CSS. Samma monster som
-- policyerna: FILEN AR SANNINGEN, DATABASEN AR KOPIAN. Skalet ar historiskt -
-- den svenska policytexten lag en gang bara i databasen och aldrig i repot,
-- och seed-skriptet hade kvar gammal engelsk text. Ligger designen bara i
-- databasen finns ingen historik, ingen diff att granska och inget satt att
-- se hur en kunds banner ar tankt att se ut.
--
-- Kommandot avvisar dessutom geometri med en forklaring, i stallet for att
-- lata vardet tyst falla bort langre fram.
--
-- KOR INTE forran:
--   1. bannern med config-stod ligger ute pa CDN:et
--   2. du matt brevenshus utseende FORE, sa du har nagot att jamfora med
--
-- seosdesign.se har med flit INGEN designfil: den overstyr ingenting alls
-- utan kor rakt pa basvardena. Dess rad ska forbli '{}'.
--
-- Verifiera sedan i webblasaren att brevenshus banner ser EXAKT likadan ut
-- som fore. Forst nar det stammer tas deras designblock bort ur <head>.


-- ---------------------------------------------------------------------------
-- ANGRA
-- ---------------------------------------------------------------------------
--
-- Ser nagot fel ut: tom raden, sa faller sajten tillbaka pa sitt designblock
-- (som ligger kvar tills allt ar verifierat). Slar igenom nar CDN-cachen
-- gatt ut, hogst 5 minuter.
--
--   UPDATE websites SET design = '{}'::jsonb WHERE domain = 'www.brevenshus.se';
--
-- Vill man backa hela steget:
--   ALTER TABLE websites DROP COLUMN design;
