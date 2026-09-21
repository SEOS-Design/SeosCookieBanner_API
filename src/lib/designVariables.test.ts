import { DESIGN_VARIABLES, GEOMETRY_VARIABLES, DESIGN_GROUPS } from "./designVariables";

/**
 * Tester for den enda listan over tillatna designvariabler.
 *
 *   npm test
 *
 * Listan lag tidigare pa TRE stallen: API:ts config-rutt, publish-design och
 * bannern. Den 2026-09-16 upptacktes att de glidit isar - `toggle-radius`
 * fanns i tva av dem, sa variabeln gick att servera men inte att publicera.
 * Testerna finns for att den sortens glidning ska synas direkt.
 */

type Case = {
  name: string;
  run: () => boolean;
  reason: string;
};

const CASES: Case[] = [
  {
    name: "toggle-radius gar att publicera",
    run: () => DESIGN_VARIABLES.has("toggle-radius"),
    reason:
      "Reglagets radie fanns i bannern och i config-rutten men saknades i " +
      "publish-design, sa den gick inte att satta for en kund.",
  },
  {
    name: "farger och typsnitt finns kvar",
    run: () =>
      ["bg-main", "text-main", "accent-color", "main-font", "radius-md"].every((v) =>
        DESIGN_VARIABLES.has(v),
      ),
    reason: "Sammanslagningen far inte tappa nagot som redan ar publicerat.",
  },
  {
    name: "geometri ar inte tillaten som designvariabel",
    run: () => !DESIGN_VARIABLES.has("banner-width"),
    reason:
      "Bannern ska kannas som samma komponent pa alla sajter. Storlekar rattas " +
      "i bannerns basvarden, aldrig per sajt.",
  },
  {
    name: "geometrilistan namnger storlekarna",
    run: () =>
      ["banner-width", "header-text-size", "space-md"].every((v) =>
        GEOMETRY_VARIABLES.has(v),
      ),
    reason:
      "Listan finns for att felmeddelandet ska kunna forklara VARFOR variabeln " +
      "hoppas over, i stallet for att bara saga 'okand'.",
  },
  {
    name: "varje variabel ligger i exakt en grupp",
    run: () => {
      const iGrupper = DESIGN_GROUPS.flatMap((g) => g.variables);
      const allaMed = [...DESIGN_VARIABLES].every((v) => iGrupper.includes(v));
      const ingaDubbletter = new Set(iGrupper).size === iGrupper.length;
      const ingaOkanda = iGrupper.every((v) => DESIGN_VARIABLES.has(v));
      return allaMed && ingaDubbletter && ingaOkanda;
    },
    reason:
      "Panelen ritar ett falt per variabel, grupp for grupp. Saknas en variabel " +
      "i grupperna gar den inte att andra i panelen - och det syns inte, for " +
      "falt som inte ritas lyser inte med sin franvaro.",
  },
  {
    name: "varje grupp har en rubrik",
    run: () => DESIGN_GROUPS.every((g) => g.title.trim().length > 0 && g.variables.length > 0),
    reason: "En namnlos eller tom grupp blir en rubrik utan innehall i panelen.",
  },
  {
    name: "ingen variabel star i bada listorna",
    run: () => ![...GEOMETRY_VARIABLES].some((v) => DESIGN_VARIABLES.has(v)),
    reason:
      "Star en variabel i bada avgor ordningen i koden vad som hander. Det ar " +
      "precis den sortens tysta motsagelse listorna ska gora omojlig.",
  },
];

let failed = 0;

for (const testCase of CASES) {
  const ok = testCase.run();
  if (ok) {
    console.log(`  ok   ${testCase.name}`);
  } else {
    failed++;
    console.error(`  FEL  ${testCase.name}\n       ${testCase.reason}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} av ${CASES.length} tester failade.\n`);
  process.exit(1);
}

console.log(`\n${CASES.length} tester ok (designVariables).\n`);
