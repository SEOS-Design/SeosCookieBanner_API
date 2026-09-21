/**
 * Vilken policyfil en sajt far vid publicering.
 *
 * REGELN:
 *   Har sajten en egen variant (en mapp policies/<sajt>/ med minst en fil)
 *   MASTE det finnas en egen fil for just den versionen. Annars hoppas sajten
 *   over - den far ALDRIG basmallen i stallet.
 *
 *   Har sajten ingen egen variant far den basmallen, policies/base/<version>.
 *
 * Varfor sa strangt: fram till 2026-09-21 fick en sajt med egen variant tyst
 * basmallen nar dess egen fil saknades. `--all --version=1.0.4` hade darmed
 * tagit bort Meta-texten fran tillvaxtstods policy och Cloudflare-cookien fran
 * tillvaxthusets. En publicerad version gar aldrig att andra, sa felet hade
 * legat kvar i bevisloggen for varje samtycke som gavs mot den.
 *
 * Ren funktion utan filsystem, sa den gar att testa. Skriptet slar upp
 * filerna och skickar in vad det hittade.
 */

export type PolicyChoice =
  | { kind: "own"; path: string }
  | { kind: "base"; path: string }
  | { kind: "skip"; reason: string };

export function choosePolicyFile(input: {
  site: string;
  version: string;
  /** Versioner i policies/<sajt>/, eller null om mappen inte finns. */
  ownVersions: string[] | null;
  baseExists: boolean;
}): PolicyChoice {
  const { site, version, ownVersions, baseExists } = input;
  const ownPath = `policies/${site}/${version}.html`;
  const basePath = `policies/base/${version}.html`;

  // En tom mapp ar ingen variant, bara en mapp nagon skapat i forvag.
  const hasOwnVariant = ownVersions !== null && ownVersions.length > 0;

  if (hasOwnVariant) {
    if (ownVersions.includes(version)) return { kind: "own", path: ownPath };
    return {
      kind: "skip",
      reason:
        `har en egen variant men ingen fil for version ${version}. ` +
        `Basmallen anvands INTE - den saknar sajtens egna tillagg. ` +
        `Skapa ${ownPath} om sajten ska fa versionen.`,
    };
  }

  if (baseExists) return { kind: "base", path: basePath };

  return {
    kind: "skip",
    reason: `ingen fil for version ${version} (varken ${ownPath} eller ${basePath})`,
  };
}
