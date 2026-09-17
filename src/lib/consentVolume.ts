/**
 * Volymlarmet (D3): vilka sajter har slutat spara samtycken?
 *
 * VARFOR: tillvaxtstod sparade inte ett enda samtycke mellan 28 juli och
 * 8 september. Bannern sag hel ut, alla skyddsnat var grona - de kontrollerar
 * att bannern RENDERAR, aldrig att ett samtycke nar fram. Den har regeln hade
 * larmat forsta dygnet efter 48 timmar.
 *
 * Regeln ligger har, fristaende fran databasen, sa att den gar att testa.
 */

/**
 * 48 och inte 24 timmar: brevenshus har bara 2-4 samtycken om dagen, och en
 * tyst natt ska inte racka for ett larm. Ett larm som gar i onodan slutar
 * betyda nagot.
 */
export const QUIET_HOURS = 48;

export type SiteActivity = {
  domain: string;
  lastConsentAt: Date | null;
};

export type QuietSite = {
  domain: string;
  lastConsentAt: string;
  hoursSilent: number;
};

/**
 * Sajter vars senaste samtycke ar aldre an granssen.
 *
 * En sajt som ALDRIG haft ett samtycke larmar inte. Annars larmar varje ny
 * sajt fran forsta minuten, innan kunden ens lagt in taggen.
 *
 * Exakt pa gransen larmar inte - forst nar den passerats.
 */
export function findQuietSites(
  sites: SiteActivity[],
  now: Date,
  quietHours: number = QUIET_HOURS,
): QuietSite[] {
  const limit = now.getTime() - quietHours * 60 * 60 * 1000;
  const quiet: QuietSite[] = [];

  for (const site of sites) {
    if (!site.lastConsentAt) continue;
    const last = site.lastConsentAt.getTime();
    if (last >= limit) continue;
    quiet.push({
      domain: site.domain,
      lastConsentAt: site.lastConsentAt.toISOString(),
      hoursSilent: Math.floor((now.getTime() - last) / (60 * 60 * 1000)),
    });
  }

  return quiet;
}
