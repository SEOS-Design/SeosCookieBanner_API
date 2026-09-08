import { consentSchema } from "./consentValidator";

/**
 * Tester for payloaden som bar varje samtycke.
 *
 *   npm test
 *
 * VARFOR DEN HAR FILEN FINNS. API:t hade inga tester alls fram till
 * 2026-09-08. Den 28 juli fick validatorn faltet site_key markt .optional(),
 * vilket tillater att faltet SAKNAS men avvisar null - och bannern skickar
 * site_key: null nar scripttaggen saknar data-site-key.
 *
 * Foljden: varje samtycke fran tillvaxtstod avvisades med 400 i SEX VECKOR.
 * Bannern sag hel ut, besokaren fick sitt val, men beviset nadde aldrig fram.
 * Omkring 1700 samtycken gick forlorade. Inget skyddsnat fangade det - de
 * kontrollerar att bannern RENDERAR, aldrig att en skrivning gar igenom.
 *
 * Ett enda av fallen nedan hade gjort sex veckor till noll minuter.
 *
 * ⚠️ LAGG TILL ETT FALL HAR NAR SCHEMAT ANDRAS. Ett falt som blir striktare
 * kan tysta ut en hel kunds bevislogg utan att nagot larmar.
 */

//========================================================================

const BAS = {
  necessary: true,
  analytics: false,
  marketing: false,
  functional: false,
  client_id: "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
  domain: "www.exempel.se",
  status: "necessary_only" as const,
  timestamp: "2026-09-08T10:00:00.000Z",
};

type Fall = { namn: string; payload: unknown; skaPassera: boolean; skal: string };

const FALL: Fall[] = [
  {
    namn: "gammal banner UTAN nyckel i taggen (site_key: null)",
    payload: { ...BAS, site_key: null },
    skaPassera: true,
    skal:
      "REGRESSIONEN. Bannern bygger payloaden med site_key: SITE_KEY, och SITE_KEY " +
      "ar null nar taggen saknar data-site-key. Avvisas den tystnar hela kundens bevislogg.",
  },
  {
    namn: "site_key saknas helt",
    payload: { ...BAS },
    skaPassera: true,
    skal: "En klient som utelamnar faltet ska falla tillbaka pa domain.",
  },
  {
    namn: "site_key som riktig nyckel",
    payload: { ...BAS, site_key: "pk_live_9619bb1c01148d467b3d40a9134147df" },
    skaPassera: true,
    skal: "Det vanliga fallet sedan B3.",
  },
  {
    namn: "site_key for kort",
    payload: { ...BAS, site_key: "pk_live" },
    skaPassera: false,
    skal: "Under atta tecken ar ingen riktig nyckel.",
  },
  {
    namn: "client_id som inte ar ett UUID",
    payload: { ...BAS, client_id: "inte-ett-uuid" },
    skaPassera: false,
    skal: "Bevisloggen kopplar besokaren till sina samtycken via UUID:t.",
  },
  {
    namn: "okant status-varde",
    payload: { ...BAS, status: "kanske" },
    skaPassera: false,
    skal: "Bara all, necessary_only och custom far loggas.",
  },
  {
    namn: "kategori saknas",
    payload: { ...BAS, marketing: undefined },
    skaPassera: false,
    skal: "Alla fyra kategorierna maste ha ett uttalat varde.",
  },
  {
    namn: "orimligt lang userAgent kapas i stallet for att avvisas",
    payload: { ...BAS, userAgent: "x".repeat(3000) },
    skaPassera: true,
    skal: "Ett ovanligt langt varde ska inte gora att ett giltigt samtycke tappas.",
  },
];

//========================================================================

let fel = 0;
console.log("\nconsentSchema\n");

for (const f of FALL) {
  const utfall = consentSchema.safeParse(f.payload);
  const ok = utfall.success === f.skaPassera;
  if (!ok) fel++;
  console.log(`  ${ok ? "ok  " : "FEL "} ${f.namn}`);
  if (!ok) {
    console.log(`       forvantat: ${f.skaPassera ? "passera" : "avvisas"}, blev: ${utfall.success ? "passerade" : "avvisades"}`);
    console.log(`       ${f.skal}`);
    if (!utfall.success) {
      console.log(`       ${JSON.stringify(utfall.error.issues.map((i) => i.path.join(".") + ": " + i.message))}`);
    }
  }
}

// Kapningen kontrolleras separat - safeParse sager bara att den gick igenom.
const kapad = consentSchema.safeParse({ ...BAS, userAgent: "x".repeat(3000) });
if (kapad.success) {
  const langd = kapad.data.userAgent?.length ?? 0;
  const ok = langd === 512;
  if (!ok) fel++;
  console.log(`  ${ok ? "ok  " : "FEL "} userAgent kapas till 512 tecken (blev ${langd})`);
}

console.log(`\n  ${FALL.length + 1} fall, ${fel} fel.\n`);
process.exit(fel === 0 ? 0 : 1);
