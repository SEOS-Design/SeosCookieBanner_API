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

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const BATCH = 500;

const usage = `
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
  const filePath = arg("fil");
  const envName = arg("env");
  const dbDirect = arg("db");
  const live = flag("kor");

  if (!filePath || (!envName && !dbDirect)) {
    console.log(usage);
    process.exit(1);
  }

  if (!existsSync(filePath)) {
    console.error(`Hittar ingen fil pa '${filePath}'.`);
    process.exit(1);
  }

  const connection = dbDirect ?? process.env[envName!];
  if (!connection) {
    console.error(`Miljovariabeln '${envName}' ar tom eller saknas.`);
    process.exit(1);
  }

  // Sparr: aterstallning mot produktion ska vara ett medvetet val, aldrig nagot
  // man rakar gora for att man kopierade fel rad ur historiken.
  if (connection === process.env.DATABASE_URL && !flag("tillat-produktion")) {
    console.error(
      "\nMalet ar PRODUKTIONSDATABASEN.\n" +
        "Lagg till --tillat-produktion om det ar meningen.\n",
    );
    process.exit(1);
  }

  // --- Las och kontrollera filen -------------------------------------------
  const copy = JSON.parse(gunzipSync(readFileSync(filePath)).toString("utf8"));

  if (!copy.tables || !Array.isArray(copy.aterstallningsordning)) {
    console.error("Filen ser inte ut som en sakerhetskopia (saknar tabeller eller ordning).");
    process.exit(1);
  }

  const order: string[] = copy.aterstallningsordning;

  console.log("");
  console.log("SAKERHETSKOPIA");
  console.log("  fil     :", filePath);
  console.log("  skapad  :", copy.skapad);
  console.log("  tabeller:", order.join(" -> "));
  console.log("");
  console.log(live ? "SKARP KORNING - rader kommer att laggas till" : "TORRKORNING - inget skrivs");
  console.log("");

  const pool = new Pool({ connectionString: connection });

  try {
    let totalMissing = 0;
    let totalInserted = 0;

    for (const table of order) {
      const rows: Record<string, unknown>[] = copy.tables[table] ?? [];
      if (rows.length === 0) {
        console.log(`  ${table.padEnd(18)} tom i kopian, hoppar over`);
        continue;
      }

      // Vilka id:n finns redan? Da vet vi vad som faktiskt saknas.
      const ids = rows.map((r) => r.id);
      const { rows: befintliga } = await pool.query(
        `SELECT id FROM "${table}" WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      const finns = new Set(befintliga.map((r) => r.id));
      const missing = rows.filter((r) => !finns.has(r.id));
      totalMissing += missing.length;

      if (missing.length === 0) {
        console.log(`  ${table.padEnd(18)} ${String(rows.length).padStart(6)} rader, inga saknas`);
        continue;
      }

      if (!live) {
        console.log(
          `  ${table.padEnd(18)} ${String(rows.length).padStart(6)} rader, ${missing.length} SAKNAS`,
        );
        continue;
      }

      const columns = Object.keys(missing[0]!);
      let inserted = 0;

      for (let i = 0; i < missing.length; i += BATCH) {
        const group = missing.slice(i, i + BATCH);
        const values: unknown[] = [];
        const placeholders = group
          .map(
            (row, radIndex) =>
              "(" +
              columns
                .map((kol, kolIndex) => {
                  values.push(row[kol]);
                  return `$${radIndex * columns.length + kolIndex + 1}`;
                })
                .join(", ") +
              ")",
          )
          .join(", ");

        const res = await pool.query(
          `INSERT INTO "${table}" (${columns.map((k) => `"${k}"`).join(", ")})
           VALUES ${placeholders}
           ON CONFLICT (id) DO NOTHING`,
          values,
        );
        inserted += res.rowCount ?? 0;
      }

      totalInserted += inserted;
      console.log(
        `  ${table.padEnd(18)} ${String(rows.length).padStart(6)} rader, ${missing.length} saknades, ${inserted} inlagda`,
      );
    }

    console.log("");
    if (live) {
      console.log(`KLART. ${totalInserted} rader aterstallda.`);
    } else if (totalMissing === 0) {
      console.log("Databasen ar redan komplett - ingenting saknas.");
    } else {
      console.log(`${totalMissing} rader saknas. Lagg till --kor for att lagga tillbaka dem.`);
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
