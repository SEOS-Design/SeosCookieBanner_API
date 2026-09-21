import { choosePolicyFile } from "./policyFile";

/**
 * Tester for vilken policyfil en sajt far vid publicering.
 *
 *   npm test
 *
 * FALLAN SOM TESTERNA FINNS FOR (upptackt 2026-09-21): en sajt med egen
 * variant men utan fil for just det versionsnumret fick tyst BASMALLEN.
 * `publish-policy --all --version=1.0.4` hade darmed gett tillvaxtstod en
 * policy utan Meta-pixeln och tillvaxthuset en utan Cloudflare-cookien - och
 * en publicerad version gar aldrig att ta tillbaka.
 */

type Case = {
  name: string;
  run: () => boolean;
  reason: string;
};

const CASES: Case[] = [
  {
    name: "sajt utan egen mapp far basmallen",
    run: () => {
      const val = choosePolicyFile({ site: "brevenshus", version: "1.0.4", ownVersions: null, baseExists: true });
      return val.kind === "base";
    },
    reason: "Sa delar seosdesign och brevenshus policy idag. Det ska fortsatta fungera.",
  },
  {
    name: "sajt med egen fil for versionen far sin egen",
    run: () => {
      const val = choosePolicyFile({ site: "tillvaxthuset", version: "1.2.0", ownVersions: ["1.1.0", "1.2.0"], baseExists: false });
      return val.kind === "own";
    },
    reason: "Grundfallet for en egen variant.",
  },
  {
    name: "sajt med egen variant men utan fil for versionen hoppas over",
    run: () => {
      const val = choosePolicyFile({ site: "tillvaxtstod", version: "1.0.4", ownVersions: ["1.1.0"], baseExists: true });
      return val.kind === "skip";
    },
    reason:
      "HELA FALLAN. Har fick sajten basmallen och tappade sina egna tillagg - " +
      "for tillvaxtstod texten om Meta-pixeln.",
  },
  {
    name: "skalet namner filen som saknas",
    run: () => {
      const val = choosePolicyFile({ site: "tillvaxtstod", version: "1.0.4", ownVersions: ["1.1.0"], baseExists: true });
      return val.kind === "skip" && val.reason.includes("policies/tillvaxtstod/1.0.4.html");
    },
    reason:
      "Den som kor kommandot ska se exakt vilken fil som behovs, inte bara att " +
      "nagot hoppades over.",
  },
  {
    name: "tom egen mapp raknas inte som egen variant",
    run: () => {
      const val = choosePolicyFile({ site: "ny", version: "1.0.4", ownVersions: [], baseExists: true });
      return val.kind === "base";
    },
    reason:
      "En tom mapp ar ingen variant - det ar en mapp nagon skapat i forvag. " +
      "Annars fastnar en ny sajt utan att ha nagot eget att skydda.",
  },
  {
    name: "ingen fil alls hoppas over",
    run: () => {
      const val = choosePolicyFile({ site: "brevenshus", version: "9.9.9", ownVersions: null, baseExists: false });
      return val.kind === "skip";
    },
    reason: "Samma beteende som forut: finns varken egen fil eller basmall publiceras inget.",
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

console.log(`\n${CASES.length} tester ok (policyFile).\n`);
