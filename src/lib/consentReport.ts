/**
 * Samtyckesrapporten: vad har en sajt faktiskt sparat?
 *
 * VARFOR: volymlarmet (consentVolume.ts) sager BARA om en sajt varit tyst for
 * lange. Ville man se vad som kommit in - hur manga, vilka val, vilken dag -
 * fanns bara handskriven SQL mot produktion. Bjorn fragade efter det
 * 2026-09-23, och en fraga som ateranvands ska ha ett kommando bakom sig,
 * annars ar den beroende av att nagon minns sin SQL.
 *
 * Regeln ligger har, fristaende fran databasen, sa att den gar att testa.
 * Skriptet (scripts/consentReport.ts) hamtar raderna och skriver ut dem.
 *
 * ⚠️ RAPPORTEN INNEHALLER INGA PERSONUPPGIFTER. Bara antal, tider och val -
 * aldrig client_id eller user agent. Vill man se en enskild besokares poster
 * finns visitor-data, som kraver ett UUID och gar till kunden. Lagg aldrig in
 * en identifierare har for bekvamlighetens skull.
 */

/**
 * Tidszonen rapporten raknar dygn i.
 *
 * ⚠️ Databasen lagrar UTC. Skulle dygnen bryta vid UTC-midnatt hamnar allt
 * mellan 00:00 och 02:00 svensk tid pa fel dag, och sommartid gor felet
 * rorligt. En rapport som Bjorn ska jamfora med sin egen dag maste rakna i
 * hans dygn. Samma forvaxling kostade en halvtimmes felsokning 2026-09-23,
 * da en commit i svensk tid jamfordes med en databasrad i UTC.
 */
export const REPORT_TIME_ZONE = "Europe/Stockholm";

/** Val som sparats. Sammastallda med event_type i databasen. */
export const EVENT_LABELS: Record<string, string> = {
  all: "alla",
  necessary_only: "endast nodvandiga",
  custom: "eget val",
};

export type ConsentRow = {
  domain: string;
  createdAt: Date;
  eventType: string;
  policyLabel: string | null;
};

export type Counted = { key: string; count: number };

export type SiteReport = {
  domain: string;
  total: number;
  /** Ett val per rad, storst forst. Tomt om sajten inte sparat nagot. */
  byType: Counted[];
  /** Ett dygn per rad, aldst forst. Dygn utan samtycken hoppas over. */
  byDay: Counted[];
  /** Policyversionerna besokarna faktiskt samtyckte till, storst forst. */
  byPolicy: Counted[];
  latest: Date | null;
};

/** YYYY-MM-DD i rapportens tidszon, inte i UTC. */
export function dayKey(date: Date, timeZone: string = REPORT_TIME_ZONE): string {
  // sv-SE ger redan formen YYYY-MM-DD, sa ingen egen hopsattning behovs.
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * "12 minuter sedan", "3 timmar sedan", "2 dygn sedan".
 *
 * Avrundar nedat, som volymlarmets hoursSilent: "2 dygn sedan" ska betyda att
 * det gatt minst tva dygn, aldrig nastan.
 */
export function formatAge(then: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (minutes < 1) return "nyss";
  if (minutes < 60) return `${minutes} minuter sedan`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} timmar sedan`;
  return `${Math.floor(hours / 24)} dygn sedan`;
}

function tally(values: string[]): Counted[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    // Storst forst, och lika stora i bokstavsordning sa utskriften inte
    // hoppar runt mellan korningar.
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * En rapport per sajt.
 *
 * `domains` styr vilka sajter som kommer med OCH i vilken ordning. En sajt utan
 * samtycken tas inte bort - den far en rapport med nollor, for det ar precis
 * den sajten man behover se. Det var sa tillvaxtstods sex tysta veckor kunde
 * passera obemarkt: tomhet syns bara om den skrivs ut.
 */
export function buildReports(
  rows: ConsentRow[],
  domains: string[],
  timeZone: string = REPORT_TIME_ZONE,
): SiteReport[] {
  const perDomain = new Map<string, ConsentRow[]>();
  for (const domain of domains) perDomain.set(domain, []);
  for (const row of rows) perDomain.get(row.domain)?.push(row);

  return domains.map((domain) => {
    const siteRows = perDomain.get(domain) ?? [];
    const latest = siteRows.reduce<Date | null>(
      (newest, row) => (!newest || row.createdAt > newest ? row.createdAt : newest),
      null,
    );

    return {
      domain,
      total: siteRows.length,
      byType: tally(siteRows.map((r) => r.eventType)),
      // Dygnen aldst forst: rapporten lases som en tidslinje.
      byDay: tally(siteRows.map((r) => dayKey(r.createdAt, timeZone))).sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
      byPolicy: tally(siteRows.map((r) => r.policyLabel ?? "okand")),
      latest,
    };
  });
}
