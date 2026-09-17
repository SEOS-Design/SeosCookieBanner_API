import { findQuietSites, QUIET_HOURS } from "./consentVolume";

/**
 * Tester for volymlarmets regel.
 *
 *   npm test
 *
 * Regeln avgor om du far ett mejl. Blir den for kanslig slutar larmet betyda
 * nagot; blir den for trog upprepas tillvaxtstods sex tysta veckor.
 */

const NOW = new Date("2026-09-17T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

type Case = {
  name: string;
  sites: { domain: string; lastConsentAt: Date | null }[];
  expectedQuiet: string[];
  reason: string;
};

const CASES: Case[] = [
  {
    name: "aktiv sajt larmar inte",
    sites: [{ domain: "www.aktiv.se", lastConsentAt: hoursAgo(1) }],
    expectedQuiet: [],
    reason: "Ett samtycke for en timme sedan ar normal drift.",
  },
  {
    name: "tyst sajt larmar",
    sites: [{ domain: "www.tyst.se", lastConsentAt: hoursAgo(49) }],
    expectedQuiet: ["www.tyst.se"],
    reason: "Hela poangen: 49 timmar utan samtycke ska ge ett larm.",
  },
  {
    name: "exakt pa gransen larmar inte",
    sites: [{ domain: "www.gransen.se", lastConsentAt: hoursAgo(QUIET_HOURS) }],
    expectedQuiet: [],
    reason: "Larmet gar forst nar gransen passerats, inte i samma sekund.",
  },
  {
    name: "ny sajt utan samtycke larmar inte",
    sites: [{ domain: "www.ny.se", lastConsentAt: null }],
    expectedQuiet: [],
    reason: "Annars larmar varje ny sajt innan kunden ens lagt in taggen.",
  },
  {
    name: "gles sajt med en tyst natt larmar inte",
    sites: [{ domain: "www.brevenshus.se", lastConsentAt: hoursAgo(30) }],
    expectedQuiet: [],
    reason: "Brevenshus har 2-4 samtycken om dagen. Darfor 48 timmar och inte 24.",
  },
  {
    name: "bara den tysta sajten larmar i en blandad lista",
    sites: [
      { domain: "www.aktiv.se", lastConsentAt: hoursAgo(2) },
      { domain: "www.tillvaxtstod.se", lastConsentAt: hoursAgo(72) },
      { domain: "www.ny.se", lastConsentAt: null },
    ],
    expectedQuiet: ["www.tillvaxtstod.se"],
    reason: "Larmet ska peka ut ratt sajt, inte bara saga att nagot ar fel.",
  },
];

let failures = 0;
console.log("\n  Volymlarmet\n");

for (const c of CASES) {
  const got = findQuietSites(c.sites, NOW).map((q) => q.domain);
  const ok = JSON.stringify(got) === JSON.stringify(c.expectedQuiet);
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FEL "} ${c.name}`);
  if (!ok) {
    console.log(`       forvantat: ${JSON.stringify(c.expectedQuiet)}, blev: ${JSON.stringify(got)}`);
    console.log(`       ${c.reason}`);
  }
}

// Antalet tysta timmar star i larmet - kontrolleras separat.
const [silent] = findQuietSites([{ domain: "www.tyst.se", lastConsentAt: hoursAgo(72.5) }], NOW);
const hoursOk = silent?.hoursSilent === 72;
if (!hoursOk) failures++;
console.log(`  ${hoursOk ? "ok  " : "FEL "} tysta timmar avrundas nedat (blev ${silent?.hoursSilent})`);

console.log(`\n  ${CASES.length + 1} fall, ${failures} fel.\n`);
process.exit(failures === 0 ? 0 : 1);
