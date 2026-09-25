import "dotenv/config";
import { and, eq, gte } from "drizzle-orm";
import { db } from "../db/client";
import { websites, consentEvent, policyVersion } from "../db/schema";
import {
  buildReports,
  formatAge,
  EVENT_LABELS,
  REPORT_TIME_ZONE,
  type ConsentRow,
} from "../lib/consentReport";

/**
 * Vad har sajterna faktiskt sparat for samtycken?
 *
 *   npm run consent-report                          alla sajter, 7 dygn
 *   npm run consent-report -- --site=hpmotorn       en sajt
 *   npm run consent-report -- --days=30             langre period
 *
 * LASER BARA. Skriptet skriver ingenting, varken i databasen eller i filer.
 *
 * VARFOR DET FINNS: volymlarmet sager bara om en sajt varit HELT tyst i mer an
 * 48 timmar. Ville man se hur det gar - hur manga samtycken, vilka val, vilken
 * dag - fanns bara handskriven SQL mot produktion. Bjorn fragade efter det
 * 2026-09-23 och ska klara det utan Claude.
 *
 * ⚠️ INGA PERSONUPPGIFTER I UTSKRIFTEN. Bara antal, tider och val. En enskild
 * besokares poster hamtas med `npm run visitor-data -- --uuid=...`, som kraver
 * att besokaren sjalv lamnat sitt UUID. Lagg aldrig till client_id eller user
 * agent har for att "det vore praktiskt" - rapporten ska kunna visas for vem
 * som helst.
 */

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

/** www.hpmotorn.se -> hpmotorn. Samma regel som publish-design och onboard. */
const toShortName = (domain: string): string => domain.replace(/^www\./, "").split(".")[0]!;

const DEFAULT_DAYS = 7;

const run = async () => {
  const site = arg("site");
  const days = Number(arg("days") ?? DEFAULT_DAYS);

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    console.error("\n--days maste vara ett heltal mellan 1 och 365.\n");
    process.exit(1);
  }

  const allSites = await db.query.websites.findMany({
    columns: { id: true, name: true, domain: true },
  });

  // Matchar bade kortnamn (hpmotorn) och full doman (www.hpmotorn.se), sa att
  // det inte spelar nagon roll vilket man rakar skriva.
  const chosen = site
    ? allSites.filter((s) => toShortName(s.domain) === toShortName(site) || s.domain === site)
    : allSites;

  if (chosen.length === 0) {
    console.error(
      `\nIngen sajt heter "${site}". Sajterna i databasen:\n` +
        allSites.map((s) => `  ${toShortName(s.domain).padEnd(16)} ${s.domain}`).join("\n") +
        "\n",
    );
    process.exit(1);
  }

  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const byId = new Map(chosen.map((s) => [s.id, s.domain]));

  const rows: ConsentRow[] = [];
  for (const s of chosen) {
    const events = await db
      .select({
        created_at: consentEvent.created_at,
        event_type: consentEvent.event_type,
        // Versionen besokaren faktiskt samtyckte till - inte den som galler i dag.
        label: policyVersion.version_label,
      })
      .from(consentEvent)
      .leftJoin(policyVersion, eq(policyVersion.id, consentEvent.policy_version_id))
      .where(and(eq(consentEvent.website_id, s.id), gte(consentEvent.created_at, from)));

    for (const e of events) {
      rows.push({
        domain: byId.get(s.id)!,
        createdAt: new Date(e.created_at),
        eventType: e.event_type,
        policyLabel: e.label ?? null,
      });
    }
  }

  const domains = chosen.map((s) => s.domain).sort((a, b) => a.localeCompare(b));
  const reports = buildReports(rows, domains);

  console.log(`\nSAMTYCKEN - senaste ${days} dygnen (tider i svensk tid)\n`);

  for (const r of reports) {
    const name = chosen.find((s) => s.domain === r.domain)!.name;
    console.log(`${r.domain}  (${name})`);

    if (r.total === 0) {
      // Tystnad ar inte ett fel forran den jamforts med normalniva - men den
      // ska synas tydligt, inte gommas bakom en nolla i en tabell.
      console.log(`  INGA SAMTYCKEN pa ${days} dygn. Kontrollera att bannern visas.\n`);
      continue;
    }

    const choices = r.byType
      .map((t) => `${EVENT_LABELS[t.key] ?? t.key} ${t.count}`)
      .join("   ");
    const perDay = r.byDay.map((d) => `${d.key.slice(5)}: ${d.count}`).join("   ");
    const policies = r.byPolicy.map((p) => `${p.key} (${p.count})`).join("   ");

    console.log(`  totalt        ${r.total} samtycken`);
    console.log(`  val           ${choices}`);
    console.log(`  senaste       ${formatLocalTime(r.latest!)}  (${formatAge(r.latest!, now)})`);
    console.log(`  per dygn      ${perDay}`);
    console.log(`  policyversion ${policies}\n`);
  }

  console.log(
    `Dygnen bryter vid midnatt i ${REPORT_TIME_ZONE}. Volymlarmet gar forst efter 48 tysta\n` +
      `timmar - den har rapporten visar lagen daremellan. En enskild besokares poster:\n` +
      `  npm run visitor-data -- --uuid=<uuid>\n`,
  );

  process.exit(0);
};

/** 2026-09-23 10:51 i rapportens tidszon. */
function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: REPORT_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

run().catch((error) => {
  console.error("\nKunde inte hamta rapporten:", error instanceof Error ? error.message : error, "\n");
  process.exit(1);
});
