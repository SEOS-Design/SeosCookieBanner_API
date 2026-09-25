import { buildReports, dayKey, formatAge } from "./consentReport";

/**
 * Tester for samtyckesrapporten.
 *
 *   npm test
 *
 * Rapporten ar det Bjorn tittar pa nar han undrar om en sajt mar bra. Raknar
 * den fel - eller tappar en tyst sajt - drar han fel slutsats om driften.
 */

const NOW = new Date("2026-09-23T09:00:00.000Z");
const at = (iso: string) => new Date(iso);

const rad = (domain: string, iso: string, eventType = "all", policyLabel: string | null = "1.1.0") => ({
  domain,
  createdAt: at(iso),
  eventType,
  policyLabel,
});

let failures = 0;
const check = (name: string, ok: boolean, reason: string, got?: unknown) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FEL "} ${name}`);
  if (!ok) {
    console.log(`       blev: ${JSON.stringify(got)}`);
    console.log(`       ${reason}`);
  }
};

console.log("\n  Samtyckesrapporten\n");

// ---------------------------------------------------------------- dygn
// Databasen lagrar UTC, Bjorn lever i svensk tid. 22:30 UTC ar redan nasta
// dygn hemma hos honom - raknar rapporten i UTC hamnar samtycket pa fel dag.
check(
  "dygnet bryter i svensk tid, inte UTC",
  dayKey(at("2026-09-22T22:30:00.000Z")) === "2026-09-23",
  "22:30 UTC ar 00:30 svensk sommartid, alltsa nasta dygn.",
  dayKey(at("2026-09-22T22:30:00.000Z")),
);
check(
  "vintertid raknas ocksa ratt",
  dayKey(at("2026-01-15T23:30:00.000Z")) === "2026-01-16",
  "Vintertid ar +01:00 - 23:30 UTC blir 00:30 nasta dag.",
  dayKey(at("2026-01-15T23:30:00.000Z")),
);

// ---------------------------------------------------------------- alder
check("minuter", formatAge(at("2026-09-23T08:48:00.000Z"), NOW) === "12 minuter sedan", "12 minuter.", formatAge(at("2026-09-23T08:48:00.000Z"), NOW));
check("timmar", formatAge(at("2026-09-23T04:00:00.000Z"), NOW) === "5 timmar sedan", "5 timmar.", formatAge(at("2026-09-23T04:00:00.000Z"), NOW));
check("dygn", formatAge(at("2026-09-20T09:00:00.000Z"), NOW) === "3 dygn sedan", "72 timmar ar 3 dygn.", formatAge(at("2026-09-20T09:00:00.000Z"), NOW));
check(
  "timmar upp till tva dygn, sedan dygn",
  formatAge(at("2026-09-21T10:00:00.000Z"), NOW) === "47 timmar sedan" &&
    formatAge(at("2026-09-21T08:00:00.000Z"), NOW) === "2 dygn sedan",
  "47 timmar sags i timmar (jamforbart med volymlarmets 48), 49 i dygn.",
  [formatAge(at("2026-09-21T10:00:00.000Z"), NOW), formatAge(at("2026-09-21T08:00:00.000Z"), NOW)],
);
check(
  "dygn avrundas nedat",
  formatAge(at("2026-09-20T10:00:00.000Z"), NOW) === "2 dygn sedan",
  "71 timmar ar tva hela dygn, inte tre - uppat vore att overdriva tystnaden.",
  formatAge(at("2026-09-20T10:00:00.000Z"), NOW),
);

// ---------------------------------------------------------------- rapport
const rows = [
  rad("www.hpmotorn.se", "2026-09-22T13:34:00.000Z", "all"),
  rad("www.hpmotorn.se", "2026-09-22T14:48:00.000Z", "necessary_only"),
  rad("www.hpmotorn.se", "2026-09-23T06:51:00.000Z", "all", "1.0.3"),
  rad("www.teorimotorn.se", "2026-09-22T18:53:00.000Z", "all"),
];
const [hp, tm, tom] = buildReports(rows, ["www.hpmotorn.se", "www.teorimotorn.se", "www.tyst.se"]);

check("totalen per sajt", hp!.total === 3 && tm!.total === 1, "Raderna ska hamna hos ratt sajt.", [hp!.total, tm!.total]);
check(
  "en sajt utan samtycken foljer med, med nollor",
  tom!.domain === "www.tyst.se" && tom!.total === 0 && tom!.latest === null,
  "Tystnad ar det viktigaste fyndet - den far aldrig falla ur listan.",
  tom,
);
check(
  "valen raknas, storst forst",
  JSON.stringify(hp!.byType) === JSON.stringify([{ key: "all", count: 2 }, { key: "necessary_only", count: 1 }]),
  "Storst forst, annars i bokstavsordning.",
  hp!.byType,
);
check(
  "dygnen kommer aldst forst",
  JSON.stringify(hp!.byDay) === JSON.stringify([{ key: "2026-09-22", count: 2 }, { key: "2026-09-23", count: 1 }]),
  "Rapporten lases som en tidslinje.",
  hp!.byDay,
);
check(
  "policyversionerna raknas",
  JSON.stringify(hp!.byPolicy) === JSON.stringify([{ key: "1.1.0", count: 2 }, { key: "1.0.3", count: 1 }]),
  "Visar vilken text besokarna faktiskt samtyckte till.",
  hp!.byPolicy,
);
check(
  "senaste samtycket ar det nyaste",
  hp!.latest?.toISOString() === "2026-09-23T06:51:00.000Z",
  "Ordningen pa raderna in far inte avgora.",
  hp!.latest,
);
check(
  "ordningen foljer sajtlistan",
  JSON.stringify(buildReports(rows, ["www.teorimotorn.se", "www.hpmotorn.se"]).map((r) => r.domain)) ===
    JSON.stringify(["www.teorimotorn.se", "www.hpmotorn.se"]),
  "Anroparen bestammer ordningen.",
);

console.log(`\n  ${failures} fel.\n`);
process.exit(failures === 0 ? 0 : 1);
