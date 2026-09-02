import "dotenv/config";
import { existsSync, writeFileSync } from "fs";
import { eq, and, asc } from "drizzle-orm";
import { db } from "../db/client";
import {
  websites,
  identity,
  consentEvent,
  consentChoice,
  consentCategory,
  policyVersion,
} from "../db/schema";

/**
 * Utdrag och radering av en besökares samtyckesposter (artikel 11, 15 och 17).
 *
 *   Visa vad som finns:  npm run visitor-data -- --uuid=<uuid>
 *   Spara utdraget:      npm run visitor-data -- --uuid=<uuid> --out=utdrag.json
 *   Vad skulle raderas:  npm run visitor-data -- --uuid=<uuid> --delete
 *   Radera på riktigt:   npm run visitor-data -- --uuid=<uuid> --delete --run
 *
 * VARFÖR SKRIPTET FINNS. Biträdesavtalets bilaga III och kundavtalets klausul
 * om identifiering lovar båda att poster som hör till ett givet UUID går att ta
 * fram eller radera. Fram till nu gick det bara med handskriven SQL mot
 * produktion. Ett löfte i ett avtal ska ha en knapp bakom sig.
 *
 * ⚠️ VI FÅR INTE SVARA BESÖKAREN SJÄLVA. Klausul 8(a): biträdet ska underrätta
 * den personuppgiftsansvarige och inte besvara begäran självt, om inte kunden
 * godkänt det. Utdraget går alltså till KUNDEN, som svarar besökaren.
 *
 * ⚠️ UTAN UUID FINNS INGEN VÄG IN, OCH DET ÄR MED FLIT. Vi lagrar inga direkta
 * identifierare — ingen IP, inget namn. Kan besökaren inte lämna sitt UUID är
 * identifiering inte möjlig, och rättigheterna i artiklarna 15–20 gäller inte i
 * den delen (artikel 11.2). Bygg aldrig in mer data "för att kunna radera":
 * det vore att förvärra integriteten för att lösa ett problem lagen redan löst.
 */

//========================================================================
// SPÄRRARNA, OCH SKÄLET TILL VAR OCH EN
//========================================================================
//
// Samma hållning som i publish-texts: en kontroll som vägrar ruttnar inte,
// vilket en instruktion i en kommentar gör.

/**
 * Bannern skapar alltid ett UUID (`crypto.randomUUID()`), så allt annat är en
 * felskrivning. Kontrollen finns för att en felskriven sträng annars ger noll
 * träffar — och noll träffar SER UT som ett giltigt svar ("den här besökaren
 * har inga uppgifter hos oss"). Det svaret får aldrig vara ett stavfel.
 */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Gallringstiden. Poster yngre än så är fortfarande bevis för en period vi
 * levererat tjänsten, och kundavtalet säger att de behålls även vid en
 * raderingsbegäran (artikel 17.3).
 *
 * ⚠️ KOPIA av RETENTION_PERIOD i routes/cron.ts. Driver de isär är priset att
 * en varning blir fel — inget raderas som inte skulle raderas ändå. Fel åt rätt
 * håll, samma resonemang som de kopierade listorna i publish-texts.
 */
const RETENTION_MONTHS = 12;

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const HELP =
  "\nUtdrag och radering för ett UUID.\n\n" +
  "  npm run visitor-data -- --uuid=<uuid>                   visa vad som finns\n" +
  "  npm run visitor-data -- --uuid=<uuid> --out=fil.json    spara utdraget\n" +
  "  npm run visitor-data -- --uuid=<uuid> --delete          visa vad som skulle raderas\n" +
  "  npm run visitor-data -- --uuid=<uuid> --delete --run    radera\n\n" +
  "UUID:t är besökarens cookie client_consent_id. Bara besökaren själv kan\n" +
  "lämna det — vi kan inte slå upp en person på något annat sätt, och ska\n" +
  "inte kunna det (artikel 11).\n";

type EventRow = {
  eventId: string;
  created_at: Date;
  event_type: string;
  user_agent: string | null;
  policy: string;
};

const run = async () => {
  const uuid = arg("uuid");
  const wantsDelete = hasFlag("delete");
  const live = hasFlag("run");
  const site = arg("site");
  const out = arg("out");
  const allowEvidenceDeletion = hasFlag("allow-evidence-deletion");

  if (!uuid) {
    console.log(HELP);
    process.exit(1);
  }

  if (!UUID_FORMAT.test(uuid)) {
    console.log(
      `\nAVVISADES: "${uuid}" ser inte ut som ett UUID.\n\n` +
        "      Bannern skapar alltid ett UUID i formen\n" +
        "      xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. En felskriven sträng hade gett\n" +
        "      noll träffar, och noll träffar ser ut som ett giltigt svar: att\n" +
        "      besökaren inte har några uppgifter hos oss. Det svaret får aldrig\n" +
        "      komma av ett stavfel.\n",
    );
    process.exit(1);
  }

  //----------------------------------------------------------------
  // HITTA IDENTITETEN, PÅ ALLA SAJTER DEN FINNS
  //----------------------------------------------------------------
  //
  // client_id är unikt per website_id, inte globalt. I praktiken hör ett UUID
  // till en sajt, eftersom cookien sätts per domän — men schemat tillåter fler,
  // och det som är möjligt ska hanteras och inte antas bort.
  const rows = await db
    .select({
      identityId: identity.id,
      identityCreated: identity.created_at,
      websiteId: websites.id,
      domain: websites.domain,
      name: websites.name,
    })
    .from(identity)
    .innerJoin(websites, eq(identity.website_id, websites.id))
    .where(eq(identity.client_id, uuid));

  if (rows.length === 0) {
    console.log(
      `\n${uuid}\n\n` +
        "Inga uppgifter hittades.\n\n" +
        "      Det betyder att UUID:t inte finns i bevisloggen. Tre förklaringar,\n" +
        "      alla lika troliga: besökaren har aldrig gjort ett val, posten är\n" +
        `      redan gallrad (${RETENTION_MONTHS} månader), eller så kommer UUID:t från en annan\n` +
        "      webbplats än de vi driver.\n\n" +
        "      Svara kunden att identifiering inte är möjlig för det lämnade\n" +
        "      UUID:t. Leta INTE vidare på något annat sätt — vi lagrar inga\n" +
        "      uppgifter som pekar ut en person, och ska inte göra det.\n",
    );
    process.exit(0);
  }

  const scoped = site
    ? rows.filter((r) => r.domain === site || r.name === site)
    : rows;

  if (site && scoped.length === 0) {
    console.log(
      `\nAVVISADES: UUID:t finns, men inte på "${site}".\n\n` +
        "      Hittades på: " +
        rows.map((r) => r.domain).join(", ") +
        "\n",
    );
    process.exit(1);
  }

  //----------------------------------------------------------------
  // HÄMTA HÄNDELSERNA OCH VALEN
  //----------------------------------------------------------------
  const perSite: {
    domain: string;
    name: string;
    identityId: string;
    identityCreated: Date;
    events: (EventRow & { choices: { category: string; status: boolean }[] })[];
  }[] = [];

  for (const row of scoped) {
    const events = await db
      .select({
        eventId: consentEvent.id,
        created_at: consentEvent.created_at,
        event_type: consentEvent.event_type,
        user_agent: consentEvent.user_agent,
        policy: policyVersion.version_label,
      })
      .from(consentEvent)
      .innerJoin(policyVersion, eq(consentEvent.policy_version_id, policyVersion.id))
      .where(eq(consentEvent.identity_id, row.identityId))
      .orderBy(asc(consentEvent.created_at));

    const withChoices = [];
    for (const event of events) {
      const choices = await db
        .select({ category: consentCategory.key, status: consentChoice.status })
        .from(consentChoice)
        .innerJoin(
          consentCategory,
          eq(consentChoice.consent_category_id, consentCategory.id),
        )
        .where(eq(consentChoice.consent_event_id, event.eventId));
      withChoices.push({ ...event, choices });
    }

    perSite.push({
      domain: row.domain,
      name: row.name,
      identityId: row.identityId,
      identityCreated: row.identityCreated,
      events: withChoices,
    });
  }

  //----------------------------------------------------------------
  // SKRIV UT DET SOM FINNS
  //----------------------------------------------------------------
  const totalEvents = perSite.reduce((n, s) => n + s.events.length, 0);
  const allEvents = perSite.flatMap((s) => s.events);
  const newest = allEvents.length
    ? new Date(Math.max(...allEvents.map((e) => e.created_at.getTime())))
    : null;

  console.log(`\n${uuid}\n`);

  for (const s of perSite) {
    console.log(`  ${s.domain}   identitet skapad ${s.identityCreated.toISOString()}`);
    if (s.events.length === 0) {
      console.log("    Inga händelser. Identiteten finns, men inget val har loggats.\n");
      continue;
    }
    for (const e of s.events) {
      const choices = e.choices
        .map((c) => `${c.category}=${c.status ? "ja" : "nej"}`)
        .join("  ");
      console.log(`    ${e.created_at.toISOString()}  ${e.event_type}  policy ${e.policy}`);
      console.log(`      ${choices || "(inga val loggade)"}`);
      if (e.user_agent) console.log(`      ${e.user_agent}`);
    }
    console.log("");
  }

  console.log(
    `  ${totalEvents} händelse${totalEvents === 1 ? "" : "r"} på ` +
      `${perSite.length} sajt${perSite.length === 1 ? "" : "er"}.\n`,
  );

  //----------------------------------------------------------------
  // UTDRAG TILL FIL
  //----------------------------------------------------------------
  if (out) {
    if (existsSync(out)) {
      console.log(
        `AVVISADES: ${out} finns redan.\n\n` +
          "      Filen innehåller personuppgifter. Att skriva över en tidigare\n" +
          "      begäran med en ny är precis den sortens misstag som inte märks.\n" +
          "      Välj ett annat filnamn.\n",
      );
      process.exit(1);
    }

    const payload = {
      uuid,
      utdrag_skapat: new Date().toISOString(),
      sajter: perSite.map((s) => ({
        domän: s.domain,
        identitet_skapad: s.identityCreated.toISOString(),
        händelser: s.events.map((e) => ({
          tidpunkt: e.created_at.toISOString(),
          typ: e.event_type,
          policyversion: e.policy,
          webbläsare: e.user_agent,
          val: Object.fromEntries(e.choices.map((c) => [c.category, c.status])),
        })),
      })),
    };

    writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
    console.log(
      `Utdraget sparat: ${out}\n\n` +
        "⚠️ Filen innehåller personuppgifter.\n" +
        "      Skicka den till KUNDEN, inte till besökaren — klausul 8(a) säger att\n" +
        "      vi inte besvarar en begäran självt. Radera filen när den är levererad,\n" +
        "      samma regel som för nedladdade säkerhetskopior.\n",
    );
  }

  if (!wantsDelete) {
    if (!out) {
      console.log(
        "Lägg till --out=fil.json för ett utdrag att skicka till kunden,\n" +
          "eller --delete för att se vad en radering skulle omfatta.\n",
      );
    }
    process.exit(0);
  }

  //----------------------------------------------------------------
  // RADERING
  //----------------------------------------------------------------
  //
  // Cascade gör resten: identity -> consent_event -> consent_choice. Verifierat
  // mot produktionsschemat 2026-09-02, åtta främmande nycklar med ON DELETE
  // CASCADE. Vi raderar därför bara identiteten.

  if (perSite.length > 1 && !site) {
    console.log(
      "AVVISADES: UUID:t finns på flera sajter.\n\n" +
        "      " +
        perSite.map((s) => s.domain).join(", ") +
        "\n\n" +
        "      En raderingsbegäran kommer från EN kund, och den kunden kan inte\n" +
        "      instruera oss att radera en annan kunds bevis. Ange vilken sajt det\n" +
        "      gäller:  --site=<domän>\n",
    );
    process.exit(1);
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  const evidence = allEvents.filter((e) => e.created_at > cutoff);

  if (evidence.length > 0 && !allowEvidenceDeletion) {
    console.log(
      `AVVISADES: ${evidence.length} av ${totalEvents} händelser är yngre än ` +
        `${RETENTION_MONTHS} månader.\n\n` +
        "      De är fortfarande BEVIS för en period vi levererat tjänsten.\n" +
        "      Kundavtalet säger att samtyckesbevis behålls under gallringstiden\n" +
        "      även vid en raderingsbegäran, med stöd av artikel 17.3 — kunden\n" +
        "      behöver dem för att kunna styrka samtycket om tillsynen frågar.\n\n" +
        "      Raderas de ändå upphör den möjligheten, och det ska vara kundens\n" +
        "      skriftliga beslut, inte vårt.\n\n" +
        "      Har kunden begärt det skriftligt:\n" +
        `        npm run visitor-data -- --uuid=${uuid} --delete --allow-evidence-deletion --run\n\n` +
        `      Posterna gallras annars av sig själva senast ` +
        `${new Date(
          Math.max(...evidence.map((e) => e.created_at.getTime())) +
            RETENTION_MONTHS * 30.44 * 24 * 3600 * 1000,
        )
          .toISOString()
          .slice(0, 10)}.\n`,
    );
    process.exit(1);
  }

  console.log(
    "SKULLE RADERAS:\n\n" +
      perSite
        .map(
          (s) =>
            `  ${s.domain}\n` +
            `    1 identitet, ${s.events.length} händelser och deras val.`,
        )
        .join("\n") +
      "\n",
  );

  if (!live) {
    console.log(
      "Torrkörning - ingenting raderat. Lägg till --run när du sett att det stämmer.\n",
    );
    process.exit(0);
  }

  for (const s of perSite) {
    await db.delete(identity).where(eq(identity.id, s.identityId));
  }

  //----------------------------------------------------------------
  // VERIFIERA, OCH SKRIV INTYGET
  //----------------------------------------------------------------
  //
  // Att kontrollera efteråt är billigt, och en radering som INTE gick igenom är
  // exakt det fel som annars aldrig upptäcks - vi skulle intyga något osant.
  const kvar = await db
    .select({ id: identity.id })
    .from(identity)
    .where(eq(identity.client_id, uuid));

  const stillThere = site
    ? kvar.length > rows.length - perSite.length
    : kvar.length > 0;

  if (stillThere) {
    console.log(
      "⚠️ RADERINGEN GICK INTE IGENOM. Rader finns kvar för UUID:t.\n" +
        "      Intyga ingenting förrän det är utrett.\n",
    );
    process.exit(1);
  }

  const backupsGone = new Date(Date.now() + 30 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  console.log(
    "Raderat och verifierat.\n\n" +
      "INTYG ATT SKICKA TILL KUNDEN:\n\n" +
      `  Vi intygar att samtliga personuppgifter kopplade till det lämnade\n` +
      `  UUID:t är raderade ur bevisloggen. Raderingen genomfördes\n` +
      `  ${new Date().toISOString().slice(0, 10)} och omfattade ${totalEvents} samtyckespost` +
      `${totalEvents === 1 ? "" : "er"}` +
      `${newest ? `, senast registrerad ${newest.toISOString().slice(0, 10)}` : ""}.\n` +
      `  Uppgifterna kan förekomma i säkerhetskopior fram till ${backupsGone},\n` +
      `  därefter är de borta även där.\n\n` +
      "⚠️ Säkerhetskopiorna lever 30 dagar. Fram till dess är raderingen inte\n" +
      "      fullständig, och det ska stå i intyget i stället för att upptäckas\n" +
      "      av någon annan.\n",
  );
  process.exit(0);
};

run().catch((error) => {
  console.error("Misslyckades:", error);
  process.exit(1);
});
