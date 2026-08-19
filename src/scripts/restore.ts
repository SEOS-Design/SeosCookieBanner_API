import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { gunzipSync } from "node:zlib";
import { Pool } from "pg";

/**
 * Aterstaller en sakerhetskopia fran Vercel Blob till en databas.
 *
 *   npm run aterstall -- --fil=backup.json.gz --env=TEST_DATABASE_URL
 *   npm run aterstall -- --fil=backup.json.gz --env=TEST_DATABASE_URL --kor
 *
 * Utan --kor gors bara en torrkorning: filen jamfors med databasen och skriptet
 * berattar vad som saknas. Ingenting skrivs.
 *
 * SA HAR ANVANDS DET VID EN INCIDENT
 *   1. Ladda ner dygnets kopia fran Vercel -> Storage -> Manage Blobs
 *   2. Skapa en Neon-branch och aterstall dit forst. Titta pa resultatet.
 *   3. Ar det ratt: kor mot produktion med --env=DATABASE_URL --tillat-produktion
 *
 * Rader som redan finns hoppas over. Det gor att samma verktyg klarar bade en
 * tom databas och en dar bara nagra rader forsvunnit - och att det ar ofarligt
 * att kora tva ganger.
 *
 * Skriptet raderar aldrig nagot. Bara tillagg.
 */

const arg = (namn: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${namn}=`))?.split("=").slice(1).join("=");

const flagga = (namn: string): boolean => process.argv.includes(`--${namn}`);

const BATCH = 500;

const anvandning = `
Anvandning:
  npm run aterstall -- --fil=<sokvag> --env=<MILJOVARIABEL> [--kor]

  --fil    Nedladdad kopia, t.ex. 2026-08-18.json.gz
  --env    Namnet pa miljovariabeln som haller anslutningen till MALdatabasen.
           Anges som namn, inte som strang, sa att losenordet aldrig hamnar i
           terminalhistoriken. T.ex. TEST_DATABASE_URL
  --db     Alternativ: anslutningsstrangen direkt (undvik om det gar)
  --kor    Utfor aterstallningen. Utan den gors bara en torrkorning.
`;

const run = async () => {
  const filvag = arg("fil");
  const envNamn = arg("env");
  const dbDirekt = arg("db");
  const skarpt = flagga("kor");

  if (!filvag || (!envNamn && !dbDirekt)) {
    console.log(anvandning);
    process.exit(1);
  }

  if (!existsSync(filvag)) {
    console.error(`Hittar ingen fil pa '${filvag}'.`);
    process.exit(1);
  }

  const anslutning = dbDirekt ?? process.env[envNamn!];
  if (!anslutning) {
    console.error(`Miljovariabeln '${envNamn}' ar tom eller saknas.`);
    process.exit(1);
  }

  // Sparr: aterstallning mot produktion ska vara ett medvetet val, aldrig nagot
  // man rakar gora for att man kopierade fel rad ur historiken.
  if (anslutning === process.env.DATABASE_URL && !flagga("tillat-produktion")) {
    console.error(
      "\nMalet ar PRODUKTIONSDATABASEN.\n" +
        "Lagg till --tillat-produktion om det ar meningen.\n",
    );
    process.exit(1);
  }

  // --- Las och kontrollera filen -------------------------------------------
  const kopia = JSON.parse(gunzipSync(readFileSync(filvag)).toString("utf8"));

  if (!kopia.tabeller || !Array.isArray(kopia.aterstallningsordning)) {
    console.error("Filen ser inte ut som en sakerhetskopia (saknar tabeller eller ordning).");
    process.exit(1);
  }

  const ordning: string[] = kopia.aterstallningsordning;

  console.log("");
  console.log("SAKERHETSKOPIA");
  console.log("  fil     :", filvag);
  console.log("  skapad  :", kopia.skapad);
  console.log("  tabeller:", ordning.join(" -> "));
  console.log("");
  console.log(skarpt ? "SKARP KORNING - rader kommer att laggas till" : "TORRKORNING - inget skrivs");
  console.log("");

  const pool = new Pool({ connectionString: anslutning });

  try {
    let totaltSaknade = 0;
    let totaltInlagda = 0;

    for (const tabell of ordning) {
      const rader: Record<string, unknown>[] = kopia.tabeller[tabell] ?? [];
      if (rader.length === 0) {
        console.log(`  ${tabell.padEnd(18)} tom i kopian, hoppar over`);
        continue;
      }

      // Vilka id:n finns redan? Da vet vi vad som faktiskt saknas.
      const idn = rader.map((r) => r.id);
      const { rows: befintliga } = await pool.query(
        `SELECT id FROM "${tabell}" WHERE id = ANY($1::uuid[])`,
        [idn],
      );
      const finns = new Set(befintliga.map((r) => r.id));
      const saknade = rader.filter((r) => !finns.has(r.id));
      totaltSaknade += saknade.length;

      if (saknade.length === 0) {
        console.log(`  ${tabell.padEnd(18)} ${String(rader.length).padStart(6)} rader, inga saknas`);
        continue;
      }

      if (!skarpt) {
        console.log(
          `  ${tabell.padEnd(18)} ${String(rader.length).padStart(6)} rader, ${saknade.length} SAKNAS`,
        );
        continue;
      }

      const kolumner = Object.keys(saknade[0]!);
      let inlagda = 0;

      for (let i = 0; i < saknade.length; i += BATCH) {
        const grupp = saknade.slice(i, i + BATCH);
        const varden: unknown[] = [];
        const platshallare = grupp
          .map(
            (rad, radIndex) =>
              "(" +
              kolumner
                .map((kol, kolIndex) => {
                  varden.push(rad[kol]);
                  return `$${radIndex * kolumner.length + kolIndex + 1}`;
                })
                .join(", ") +
              ")",
          )
          .join(", ");

        const res = await pool.query(
          `INSERT INTO "${tabell}" (${kolumner.map((k) => `"${k}"`).join(", ")})
           VALUES ${platshallare}
           ON CONFLICT (id) DO NOTHING`,
          varden,
        );
        inlagda += res.rowCount ?? 0;
      }

      totaltInlagda += inlagda;
      console.log(
        `  ${tabell.padEnd(18)} ${String(rader.length).padStart(6)} rader, ${saknade.length} saknades, ${inlagda} inlagda`,
      );
    }

    console.log("");
    if (skarpt) {
      console.log(`KLART. ${totaltInlagda} rader aterstallda.`);
    } else if (totaltSaknade === 0) {
      console.log("Databasen ar redan komplett - ingenting saknas.");
    } else {
      console.log(`${totaltSaknade} rader saknas. Lagg till --kor for att lagga tillbaka dem.`);
    }
    console.log("");
  } finally {
    await pool.end();
  }
};

run().catch((e) => {
  console.error("Aterstallningen misslyckades:", e.message);
  process.exit(1);
});
