import { injectBanner } from "./injectBanner";

/**
 * Tester for hur designpanelen lagger in bannern i en sajt som annu saknar den.
 *
 *   npm test
 *
 * Varfor det finns: panelen visar bannern pa kundens riktiga sajt. Fore
 * lansering finns ingen banner dar, och darfor blev det skarmbilder i stallet
 * (2026-09-21). Nu lagger panelen in taggen sjalv - bara i panelens eget
 * fonster, aldrig pa sajten.
 */

const KEY = "pk_live_3c5d0f95f489f89d580dca2879778e2a";
const PAGE = "<html><head><title>x</title></head><body><main>Hej</main></body></html>";

type Case = {
  name: string;
  run: () => boolean;
  reason: string;
};

const CASES: Case[] = [
  {
    name: "bannertaggen hamnar fore </body> med nyckeln",
    run: () => {
      const { html, injected } = injectBanner(PAGE, KEY);
      const tag = html.indexOf("/v1/banner.js");
      return injected && tag > 0 && tag < html.indexOf("</body>") && html.includes(`data-site-key="${KEY}"`);
    },
    reason: "Grundfallet. Utan nyckeln hittar bannern ingen design att visa.",
  },
  {
    name: "en sajt som redan har bannern lamnas orord",
    run: () => {
      const live = PAGE.replace(
        "</body>",
        `<script src="https://seos-cookie-banner.vercel.app/v1/banner.js" data-site-key="${KEY}" async></script></body>`,
      );
      const { html, injected } = injectBanner(live, KEY);
      return !injected && html === live;
    },
    reason:
      "Efter lansering ska panelen visa exakt det besokaren far. Tva bannrar pa " +
      "samma sida vore dessutom ett eget fel att felsoka.",
  },
  {
    name: "versaler i </BODY> fungerar",
    run: () => {
      const { html, injected } = injectBanner(PAGE.replace("</body>", "</BODY>"), KEY);
      return injected && html.indexOf("/v1/banner.js") < html.indexOf("</BODY>");
    },
    reason: "HTML ar skiftlageslos. Ett Webflow- eller WordPress-tema kan skriva vilket som.",
  },
  {
    name: "sida utan </body> far taggen sist",
    run: () => {
      const { html, injected } = injectBanner("<html><body><p>trasig", KEY);
      return injected && html.trimEnd().endsWith("</script>");
    },
    reason:
      "Webblasaren accepterar HTML utan avslutande tagg. Panelen ska ocksa gora " +
      "det, i stallet for att tyst visa en sajt utan banner.",
  },
  {
    name: "en nyckel i fel format vagras",
    run: () => {
      try {
        injectBanner(PAGE, 'pk_live_x" onload="alert(1)');
        return false;
      } catch {
        return true;
      }
    },
    reason:
      "Nyckeln skrivs in i ett HTML-attribut. Ett citattecken i den hade kunnat " +
      "bryta sig ut ur attributet. Den kommer fran var egen databas, men " +
      "kontrollen kostar ingenting.",
  },
  {
    name: "resten av sidan ar oforandrad",
    run: () => {
      const { html } = injectBanner(PAGE, KEY);
      const utanTaggen = html.replace(/<script[^>]*v1\/banner\.js[^>]*><\/script>/, "");
      return utanTaggen === PAGE;
    },
    reason: "Panelen ska visa kundens sajt som den ar, plus bannern - inget annat.",
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

console.log(`\n${CASES.length} tester ok (injectBanner).\n`);
