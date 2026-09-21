import { parseVariables, toDesignCss, contrastRatio } from "./designFile";

/**
 * Tester for designfilen och kontrastrakningen.
 *
 *   npm test
 *
 * Filen `design/<kund>.css` ar sanningen och databasen ar kopian. Kan den inte
 * lasas och skrivas tillbaka utan att tappa nagot, driver de tva isar - och da
 * ar det kundens banner som andras, inte en rad i en fil.
 *
 * Kontrasten testas mot varden som redan star nedskrivna i tillvaxthusets
 * designfil, uppmatta 2026-09-17. Gar rakningen sonder ska de siffrorna sluta
 * stamma.
 */

// Kontrasten kan vara null for varden som inte ar farger. I testerna blir null
// till NaN, sa varje jamforelse failar i stallet for att smita igenom.
const kvot = (a: string, b: string): number => contrastRatio(a, b) ?? NaN;

type Case = {
  name: string;
  run: () => boolean;
  reason: string;
};

const CASES: Case[] = [
  // --- Lasa filen -----------------------------------------------------
  {
    name: "laser en enkel variabel",
    run: () => parseVariables(":root { --bg-main: #ffffff; }")["bg-main"] === "#ffffff",
    reason: "Grundfallet. Utan det fungerar ingenting annat.",
  },
  {
    name: "kommentarer ignoreras",
    run: () => {
      const css = ":root {\n  /* --bg-main: #000000; */\n  --bg-main: #ffffff;\n}";
      return parseVariables(css)["bg-main"] === "#ffffff";
    },
    reason:
      "Designfilerna ar fulla av kommentarer som forklarar valen, och flera " +
      "innehaller bortkommenterade varden. Lases de blir bannern fel.",
  },
  {
    name: "flerradiga varden plattas till en rad",
    run: () =>
      parseVariables(":root { --fokus-ring: 2px\n    solid\n    #0f2544; }")["fokus-ring"] ===
      "2px solid #0f2544",
    reason:
      "Ett CSS-varde far spanna flera rader i filen men ska lagras som en rad " +
      "i databasen.",
  },

  // --- Skriva filen ---------------------------------------------------
  {
    name: "skriven fil gar att lasa tillbaka",
    run: () => {
      const original = { "bg-main": "#ffffff", "radius-lg": "20px" };
      const tillbaka = parseVariables(toDesignCss(original, { title: "Testkund" }));
      return tillbaka["bg-main"] === "#ffffff" && tillbaka["radius-lg"] === "20px";
    },
    reason:
      "Panelen skriver filen och publiceringen laser den. Tappar varvet ett " +
      "varde upptacks det forst pa kundens sajt.",
  },
  {
    name: "rubriken hamnar i filen",
    run: () => toDesignCss({ "bg-main": "#fff" }, { title: "Tillvaxthuset" }).includes("Tillvaxthuset"),
    reason:
      "Filerna las av manniskor. Utan rubrik gar det inte att se vilken kund " +
      "filen hor till nar den ligger oppen i en flik.",
  },
  {
    name: "ett varde med url() vagrar skrivas",
    run: () => {
      try {
        toDesignCss({ "bg-main": "url(https://example.com/x.png)" }, { title: "X" });
        return false;
      } catch {
        return true;
      }
    },
    reason:
      "Samma sparr som i API:t och i publish-design: ett CSS-varde med url() " +
      "far webblasaren att hamta nagot fran en adress vi inte valt.",
  },
  {
    name: "geometri vagras med ett forklarande fel",
    run: () => {
      try {
        toDesignCss({ "banner-width": "500px" }, { title: "X" });
        return false;
      } catch (error) {
        return String(error).includes("geometri");
      }
    },
    reason:
      "Panelen ska inte kunna skriva en variabel som publiceringen sedan " +
      "hoppar over. Da ser det ut som att andringen tog, men den gjorde inte det.",
  },

  // --- Kontrast -------------------------------------------------------
  {
    name: "svart mot vitt ger 21:1",
    run: () => Math.round(kvot("#000000", "#ffffff")) === 21,
    reason: "Det hogsta mojliga vardet. Ar det fel ar hela rakningen fel.",
  },
  {
    name: "tillvaxthusets textfarg mot vitt ger 14,5:1",
    run: () => Math.abs(kvot("#1c2b3a", "#ffffff") - 14.5) < 0.2,
    reason:
      "Siffran ar uppmatt och nedskriven i design/tillvaxthuset.css 2026-09-17. " +
      "Ett riktigt varde ur produktionen, inte ett hittepa.",
  },
  {
    name: "den dampade farg vi valde bort underkanns",
    run: () => kvot("#8fa3b5", "#ffffff") < 4.5,
    reason:
      "2,6:1 mot vitt. Den fargen valdes bort ur tillvaxthusets design just " +
      "darfor - panelen ska saga ifran pa samma grund.",
  },
  {
    name: "ordningen spelar ingen roll",
    run: () =>
      Math.abs(kvot("#1c2b3a", "#ffffff") - kvot("#ffffff", "#1c2b3a")) < 0.001,
    reason:
      "Kontrast ar ett forhallande mellan tva ljusheter. Byter man plats pa " +
      "text och bakgrund ska samma siffra komma ut.",
  },
  {
    name: "kortform med tre tecken fungerar",
    run: () => Math.round(kvot("#fff", "#000")) === 21,
    reason: "Designfilerna innehaller bade #ffffff och #fff. Bada skrivs av manniskor.",
  },
  {
    name: "ett varde som inte ar en farg ger null",
    run: () => contrastRatio("var(--nagot)", "#ffffff") === null,
    reason:
      "Typsnitt och radier gar inte att rakna kontrast pa, och en variabel kan " +
      "peka pa sajtens egen. Panelen ska da visa ingenting - inte en falsk siffra.",
  },
];

let failed = 0;

for (const testCase of CASES) {
  let ok = false;
  try {
    ok = testCase.run();
  } catch (error) {
    console.error(`  KRASCH ${testCase.name}: ${error}`);
  }
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

console.log(`\n${CASES.length} tester ok (designFile).\n`);
