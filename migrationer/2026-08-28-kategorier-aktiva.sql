-- ============================================================================
-- C1 steg 2: vilka kategorier en sajt visar
-- ============================================================================
--
-- Korrs i Neon SQL Editor, INTE med drizzle-kit push. Ta en branch-snapshot
-- forst - det ar sekunder och det ar enda vagen tillbaka.
--
-- Korrs i TVA omgangar med verifiering emellan. Steg 1 ar ofarligt och kan
-- koras nar som helst. Steg 2 andrar vad en KUNDS besokare ser i
-- installningsrutan och ska koras forst nar bannern som laser kategorierna
-- ligger ute - och da en sajt i taget, matt fore och efter.
--
-- SKILLNAD MOT C1 STEG 1, vard att kanna till: designvardena satts som INLINE
-- STYLE och slog darfor igenom hos kunden i samma sekund som de fanns i
-- databasen - de kunde inte tystas av kundens egna regler. Kategorier beter
-- sig tvartom: en banner som inte laser faltet ignorerar det helt enkelt.
-- Darfor ar ordningen friare har, och API:t kan ga ut fore bannern.


-- ---------------------------------------------------------------------------
-- STEG 1 - lagg till kolumnen. Ofarligt.
-- ---------------------------------------------------------------------------
--
-- Default true betyder att varje kategori pa varje sajt fortsatter visas
-- precis som idag. Sa lange ingen rad satts till false beter sig systemet
-- exakt som fore steg 2, aven med bade API och banner ute. Det gor
-- utrullningen omvandbar utan att nagon rad behover roras.

ALTER TABLE consent_category
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Kontroll: tolv rader (fyra kategorier x tre sajter), alla aktiva.
--
--   SELECT w.domain, c.key, c.is_required, c.is_active
--     FROM consent_category c
--     JOIN websites w ON w.id = c.website_id
--    ORDER BY w.domain, c.key;


-- ---------------------------------------------------------------------------
-- STEG 2 - dolj en kategori pa en sajt
-- ---------------------------------------------------------------------------
--
-- RADERA ALDRIG EN KATEGORIRAD. Det ar hela skalet till att kolumnen finns.
--
-- consent_choice pekar pa consent_category med ON DELETE CASCADE. En DELETE
-- pa raden for 'functional' raderar darfor VARJE historiskt val besokare
-- gjort for den kategorin. Tyst, utan felmeddelande, och utan att antalet
-- rader i consent_event forandras - sa ingenting ser trasigt ut efterat.
--
-- Det ar bevisloggen. Den ar tjanstens karnlofte och det enda i systemet som
-- inte gar att aterskapa. En kategori DOLJS, den raderas inte.
--
-- KOR INTE forran:
--   1. bannern som laser kategorierna ligger ute pa CDN:et
--   2. du oppnat sajtens installningsruta och sett hur den ser ut FORE
--
-- En sajt i taget:
--
--   UPDATE consent_category
--      SET is_active = false
--    WHERE key = 'functional'
--      AND website_id = (
--            SELECT id FROM websites WHERE domain = 'www.brevenshus.se'
--          );
--
-- Verifiera sedan i webblasaren att kortet ar borta och att de ovriga tre ser
-- likadana ut som fore. Adressen ?seos_farsk=1 gar forbi cachen sa du slipper
-- vanta pa att timmen ska ga ut.


-- ---------------------------------------------------------------------------
-- ANGRA
-- ---------------------------------------------------------------------------
--
-- Ser nagot fel ut: tand kategorin igen. Slar igenom nar CDN-cachen gatt ut,
-- hogst en timme - eller direkt med ?seos_farsk=1.
--
--   UPDATE consent_category SET is_active = true WHERE key = 'functional';
--
-- Vill man backa hela steget:
--
--   ALTER TABLE consent_category DROP COLUMN is_active;
--
-- Kolumnen bar ingen egen information utover pa/av, sa den gar att lagga
-- tillbaka nar som helst utan att nagot gatt forlorat.
