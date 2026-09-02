import "dotenv/config";
import { copyFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { websites, consentCategory, policyVersion } from "../db/schema";

/**
 * D1 - satter upp en ny kundsajt i ett svep.
 *
 *   Torrkorning:  npm run onboard -- --domain=www.nykund.se --name="Ny Kund"
 *   Skarpt:       npm run onboard -- --domain=www.nykund.se --name="Ny Kund" --run
 *
 * ERSATTER `npm run seed` FOR NYA KUNDER. seed finns kvar for den lokala
 * utvecklingssajten (127.0.0.1) och rors inte.
 *
 * VARFOR DEN HAR FINNS - och det ar inte tidsbesparingen.
 *
 * En ny sajt kravde nio steg i fem olika verktyg, och ingenting sa till om nagot
 * hoppats over. Ett GLOMT STEG ar osynligt:
 *
 *   - Glommer man raden i tests/sajter.js blir sajten aldrig overvakad. Bannern
 *     kan do dar utan att nagon far veta. Det ar exakt vad som hande brevenshus
 *     2026-08-03, innan D3 fanns.
 *   - Glommer man allowed_origins fungerar allt anda, men origin-kontrollen ar
 *     avstangd for den kunden. Inget larmar.
 *
 * Gangar femton sajter ar det inte en fraga om, utan nar. Darfor gor skriptet
 * det som gar, och SKRIVER UT det som inte gar - i stallet for att lita pa att
 * nagon minns ett dokument.
 *
 * ⚠️ ROR INTE ANDRA REPON. Raden till bannerrepots tests/sajter.js skrivs UT,
 * den skrivs inte. Ett skript som redigerar filer i ett annat repo ar en
 * overraskning som forr eller senare gor fel sak i fel klon.
 */

//========================================================================
// ARGUMENT
//========================================================================

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

/** www.brevenshus.se -> brevenshus. Samma regel som publish-design anvander. */
const toShortName = (domain: string): string =>
  domain.replace(/^www\./, "").split(".")[0]!;

// Basmallen som en ny sajt startar pa. Hojs den har far bara NYA sajter den -
// befintliga byter version med publish-policy, som forut.
const POLICY_VERSION = "1.0.3";

// Kategorierna varje ny sajt far. Alla fyra som reglage fran start, med flit:
// man kan aldrig gora fel genom att FRAGA om for mycket. Snava av senare, nar
// cookie-skannern visat vad sajten faktiskt anvander (se driftmanualen 14).
const CATEGORIES = [
  { key: "necessary", description: "Cookies necessary for basic website functionality.", is_required: true },
  { key: "functional", description: "Remembers your choices and settings.", is_required: false },
  { key: "analytics", description: "Used for visitor statistics and performance.", is_required: false },
  { key: "marketing", description: "Used for targeted advertising.", is_required: false },
];

//========================================================================

const run = async () => {
  const domain = arg("domain");
  const name = arg("name");
  const live = hasFlag("run");

  if (!domain || !name) {
    console.error(
      "\nAnvandning:\n" +
        '  npm run onboard -- --domain=www.nykund.se --name="Ny Kund"          (torrkorning)\n' +
        '  npm run onboard -- --domain=www.nykund.se --name="Ny Kund" --run    (skarpt)\n',
    );
    process.exit(1);
  }

  // Databasen registrerar www-varianten. Apex redirectar dit, sa Origin blir
  // alltid www - se B2-anteckningarna i projektminnet.
  if (!/^www\./.test(domain)) {
    console.error(
      `\nDomanen ska skrivas med www: www.${domain}\n\n` +
        "Databasen registrerar www-varianten eftersom apex redirectar dit,\n" +
        "sa besokarens Origin alltid blir www. Registreras apex slar\n" +
        "origin-kontrollen fel och samtycken avvisas tyst.\n",
    );
    process.exit(1);
  }

  const shortName = toShortName(domain);
  const origin = `https://${domain}`;
  const designFile = join("design", `${shortName}.css`);
  const policyFile = join("policies", "base", `${POLICY_VERSION}.html`);

  if (!existsSync(policyFile)) {
    console.error(`\nHittar inte basmallen ${policyFile}.\n`);
    process.exit(1);
  }

  const existing = await db.query.websites.findFirst({
    where: eq(websites.domain, domain),
    columns: { id: true, site_key: true },
  });

  console.log(`\n${domain}   (kortnamn: ${shortName})\n`);

  // Vid torrkorning finns ingen nyckel an for en NY sajt. En befintlig sajt
  // visar sin riktiga, sa raden gar att kopiera direkt.
  let siteKey: string = existing?.site_key ?? "<skapas nar du kor --run>";

  const planned: string[] = [];
  if (existing) {
    planned.push("  ~ sajten finns redan - kompletterar det som saknas");
  } else {
    planned.push("  + websites-rad med ny site key");
  }
  planned.push(`  + allowed_origins: ${origin}`);
  planned.push(`  + policyversion ${POLICY_VERSION} fran ${policyFile}`);
  planned.push(`  + ${CATEGORIES.length} kategorier, alla som reglage`);
  planned.push(
    existsSync(designFile)
      ? `  ~ ${designFile} finns redan - lamnas orord`
      : `  + ${designFile} fran design/_mall.css`,
  );
  console.log(planned.join("\n") + "\n");

  // Checklistan ritas fran en funktion sa att BADA vagarna kan visa den.
  // Torrkorningen visade den inte forut, vilket var bakvant: stegen gick
  // inte att lasa forran sajten redan var skapad i produktion.
  const manualSteps = () => `
${"=".repeat(74)}
KVAR ATT GORA FOR HAND
${"=".repeat(74)}

ORDNINGEN I KUNDENS <head> - fyra saker, i den har foljden:

  1. Vaktsnutten          allra forst, fore allt
  2. Consent default
  3. GTM eller gtag
  4. Bannerns scriptrad

⚠️ INGET DESIGNBLOCK. Designen kommer fran databasen sedan C1 steg 1.
   Klistras ett designblock in overstyr det databasen, och framtida andringar
   via publish-design nar aldrig fram. Aldre anteckningar sager nagot annat -
   de ar skrivna fore 2026-08-21.

1. VAKTSNUTTEN - allra forst i kundens <head>:

   Oppna guard-snippet.html i BANNERREPOT och kopiera innehallet. Klistra
   in det overst i <head>. Cirka 900 tecken inline, inget natverksanrop.
   Identisk for alla kunder - den bar inget sajtspecifikt.

   Filen ar byggd och committad, sa den gar att kopiera direkt. Behover du
   bygga om den: 'npm run build' i bannerrepot. CI kontrollerar vid varje
   push att den ar i synk med banner-src/guard.js.

   ⚠️ ORDNINGEN AR HELA POANGEN. Vakten fangar skript som skapas av
   JavaScript och maste hinna fore dem. Ligger den efter en tredjepart som
   laddar sig sjalv har den missat sitt enda jobb.

   Vakten slapper ALDRIG fram nagot sjalv - den haller tillbaka och lagger
   undan. Bannern slapper fram nar besokaren sagt ja. Uteblir bannern forblir
   det tillbakahallet, vilket ar det sakra felet.

   Kontrollera efterat med 'npm run overvaka' i bannerrepot - den skriver
   'vakt' eller 'ingen vakt' per sajt. Ingen devtools behovs.
   Rutinen i driftmanualen 16.

2. SCRIPTTAGGEN - i kundens <head>, efter consent default och GTM/gtag:

   <script src="https://seos-cookie-banner.vercel.app/v1/banner.js"
           data-site-key="${siteKey}" async></script>

3. OVERVAKNINGEN - lagg till i BANNERREPOTS tests/sajter.js:

   {
     namn: '${shortName}',
     url: '${origin}/',
     skript: '/v1/banner.js',
     accepteraText: 'Acceptera alla',
     tillatnaCookies: [],
     tillatnaSparare: ['google-analytics.com', 'analytics.google.com'],
   },

   ⚠️ Hoppas det har over blir sajten ALDRIG overvakad, och en dod banner
   upptacks av en kund i stallet for av oss.

4. WEBFLOW-FALLAN - ar sajten i Webflow: Apps & Integrations -> Google tag
   ska vara TOM. Dess snutt laddas fore all anpassad huvudkod, sa GA satter
   cookies fore samtycke och ordningen gar inte att styra. Ladda GA fran
   anpassad huvudkod i stallet, efter consent-blocket.

5. UNDERSIDORNA - oppna kontaktsida och artikelsidor och leta inbaddningar
   (bokningskalendrar, YouTube, kartor, chatt). De sitter ALDRIG pa
   startsidan, sa cookie-skannern ser dem inte.

   ⛔ HALL INTE TILLBAKA NAGOT REFLEXMASSIGT. Fyra fragor, i ordning:

     1. Sparar den?                     Nej -> gor ingenting (cal.com)
     2. Bad besokaren om den?           Ja  -> ladda vid klicket i stallet
     3. Gar sidan att anvanda utan den? Nej -> manskligt beslut
     4. Syns det, och ett klick vidare? Nej -> gor det inte

   En besokare som inte kan boka ett mote eller se en video ar ett samre
   utfall an en cookie vi kunde ha stoppat. Ett bokningsformulare ska
   ALDRIG sparras bakom ett cookieval.

   Ska nagot hallas tillbaka - sa har markeras det pa kundens sajt:

     <script type="text/plain" data-seos-consent="marketing" src="..."></script>

     <iframe data-seos-consent="marketing"
             data-seos-src="https://www.youtube.com/embed/xxxx"
             width="640" height="360"></iframe>

   ⚠️ For skriptet ar det type="text/plain" som haller tillbaka det, inte
   attributet. For iframen maste adressen FLYTTAS fran src till
   data-seos-src. Bannern sager ifran i konsolen om det blivit fel, men
   ett skript som redan korrt gar inte att ta tillbaka.

   Laddar sajtens EGEN kod nagot vid klick finns window.SEOS.hasConsent()
   och window.SEOS.onConsentChange(). Hela rutinen i driftmanualen 15.

6. ⏳ VANTA FEM MINUTER innan du testar ett samtycke.

   API:t cachar listan over tillatna origins i minnet i fem minuter
   (CACHE_MS i src/index.ts). Sajtens adress finns i databasen redan nu, men
   en funktionsinstans med gammal cache avvisar den anda - besokaren far 403
   och samtycket loggas inte.

   Det ar INTE ett fel och det gar over av sig sjalvt. Men testar du direkt
   ser det ut som att uppsattningen misslyckats.

7. KONTROLLERA, i den har ordningen:

   npm run granska -- ${origin}          (kontrast, i bannerrepot)
   npm run skanna -- --full ${shortName}      (vad sajten drar in, i bannerrepot)
   npm run overvaka                      (renderar bannern skarpt)

8. DESIGNEN - fyll i ${designFile} och publicera:

   npm run publish-design -- --site=${shortName}          (torrkorning)
   npm run publish-design -- --site=${shortName} --run    (skarpt)

   Har kunden ingen egen formgivning: radera filen, sa kor de basvardena.

${"=".repeat(74)}
`;

  if (!live) {
    console.log(manualSteps());
    console.log(
      "TORRKORNING - INGENTING AR SKRIVET.\n\n" +
        "Stegen ovan ar de som vantar efter att du kort skarpt. For en NY sajt\n" +
        "finns ingen site key an - den skapas av --run och skrivs ut da.\n\n" +
        "Lagg till --run nar du sett att det stammer.\n",
    );
    process.exit(0);
  }

  //----------------------------------------------------------------
  // 1. Sajten
  //----------------------------------------------------------------
  let websiteId: string;

  if (existing) {
    websiteId = existing.id;
    siteKey = existing.site_key ?? "";
    // En sajt utan nyckel ar en kvarleva fran fore B3. Ge den en.
    if (!siteKey) {
      siteKey = `pk_live_${randomBytes(16).toString("hex")}`;
      await db.update(websites).set({ site_key: siteKey }).where(eq(websites.id, websiteId));
    }
    // allowed_origins skrivs bara om den ar tom, sa en sajt med staging-adresser
    // inte tappar dem.
    const row = await db.query.websites.findFirst({
      where: eq(websites.id, websiteId),
      columns: { allowed_origins: true },
    });
    if (!row?.allowed_origins?.length) {
      await db.update(websites).set({ allowed_origins: [origin] }).where(eq(websites.id, websiteId));
    }
  } else {
    siteKey = `pk_live_${randomBytes(16).toString("hex")}`;
    const [ny] = await db
      .insert(websites)
      .values({ name, domain, site_key: siteKey, allowed_origins: [origin] })
      .returning({ id: websites.id });
    websiteId = ny!.id;
  }
  console.log(`[1/4] Sajt      ${websiteId}`);

  //----------------------------------------------------------------
  // 2. Policyn
  //----------------------------------------------------------------
  await db
    .insert(policyVersion)
    .values({
      website_id: websiteId,
      version_label: POLICY_VERSION,
      content_html: readFileSync(policyFile, "utf-8"),
      valid_from: new Date(),
    })
    .onConflictDoNothing({
      target: [policyVersion.website_id, policyVersion.version_label],
    });
  console.log(`[2/4] Policy    ${POLICY_VERSION}`);

  //----------------------------------------------------------------
  // 3. Kategorierna
  //----------------------------------------------------------------
  for (const category of CATEGORIES) {
    await db
      .insert(consentCategory)
      .values({ website_id: websiteId, ...category })
      .onConflictDoNothing({
        target: [consentCategory.website_id, consentCategory.key],
      });
  }
  console.log(`[3/4] Kategorier ${CATEGORIES.map((k) => k.key).join(", ")}`);

  //----------------------------------------------------------------
  // 4. Designfilen
  //----------------------------------------------------------------
  if (!existsSync(designFile)) {
    copyFileSync(join("design", "_mall.css"), designFile);
    console.log(`[4/4] Design    ${designFile} skapad fran mallen`);
  } else {
    console.log(`[4/4] Design    ${designFile} fanns redan`);
  }

  console.log(manualSteps());

  process.exit(0);
};

run().catch((error) => {
  console.error("\nOnboardingen misslyckades:", error);
  process.exit(1);
});
