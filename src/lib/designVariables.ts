/**
 * ENDA LISTAN over vilka CSS-variabler en sajt far satta.
 *
 * Fram till 2026-09-18 fanns listan pa TRE stallen: `routes/config.ts`
 * (vad som serveras), `scripts/publishDesign.ts` (vad som gar att publicera)
 * och bannerns `banner-src/DESIGN_VARIABLES` (vad som faktiskt ritas).
 * De glider isar tyst: `toggle-radius` lades till i tva av dem, sa variabeln
 * gick att servera men inte att publicera, och felet syntes forst nar en kund
 * skulle fa kantiga reglage.
 *
 * ⚠️ BANNERNS LISTA LIGGER I ETT ANNAT REPO och kan inte importeras harifran.
 * Andras listan har ska `banner-src/script.js` andras i samma veva - annars
 * publiceras ett varde som bannern kastar. Kontrollen ar manuell, med flit:
 * ett byggsteg mellan repona hade varit dyrare an den har kommentaren.
 */

export type DesignGroup = {
  /** Rubrik i designpanelen. */
  title: string;
  /** Vilken sorts falt panelen ska rita. */
  kind: "color" | "text";
  variables: string[];
};

/**
 * Utseende som FAR sattas per sajt, grupperat som i designfilerna.
 *
 * Grupperingen ar inte bara for panelens skull: den gor listan lasbar bredvid
 * en `design/<kund>.css`, dar samma rubriker star som kommentarer.
 *
 * ⚠️ En ny variabel laggs till HAR, i en grupp. `DESIGN_VARIABLES` byggs av
 * grupperna, sa en variabel som gloms bort finns inte alls - i stallet for att
 * finnas men sakna falt i panelen, vilket ingen hade upptackt.
 */
export const DESIGN_GROUPS: DesignGroup[] = [
  {
    title: "Bakgrund och text",
    kind: "color",
    variables: ["bg-main", "bg-muted", "text-main", "text-muted"],
  },
  {
    title: "Accent och kanter",
    kind: "color",
    variables: ["accent-color", "accent-hover", "bg-dark-btn", "border-color", "btn-border"],
  },
  {
    title: "Ikon och reglage",
    kind: "color",
    variables: [
      "logo-color",
      "bg-logo-wrapper",
      "bg-customize-btn",
      "toggle-switch-bg",
      "toggle-circle",
    ],
  },
  {
    title: "Knapptext och hovring",
    kind: "text",
    variables: [
      "btn-accent-text",
      "btn-hover-filter",
      "btn-secondary-hover-bg",
      "btn-secondary-hover-filter",
    ],
  },
  {
    // Egna variabler sa en sajt kan gora dem synliga mot sin egen bakgrund.
    // En fokusring som inte syns ar samma sak som ingen ring.
    title: "Tillganglighet",
    kind: "text",
    variables: ["fokus-ring", "scrollbar-thumb", "policy-link-color", "badge-text-color"],
  },
  {
    title: "Ovrigt utseende",
    kind: "text",
    variables: ["scroll-gradient"],
  },
  {
    // Bannern laddar aldrig egna typsnitt - den anvander de sajten redan har.
    title: "Typsnitt",
    kind: "text",
    variables: ["main-font", "header-font"],
  },
  {
    // toggle-radius: reglagets egen radie. Lag tidigare pa radius-md, som ocksa
    // styr knapparna - kantiga knappar gav kantiga reglage pa kopet.
    title: "Radier",
    kind: "text",
    variables: ["radius-sm", "radius-md", "radius-lg", "toggle-radius"],
  },
];

/** Alla tillatna designvariabler, byggda av grupperna ovan. */
export const DESIGN_VARIABLES = new Set(DESIGN_GROUPS.flatMap((group) => group.variables));

/**
 * Storlekar som INTE far sattas per sajt.
 *
 * Listan finns for att ett felmeddelande ska kunna forklara varfor: bannern
 * ska kannas som samma komponent pa alla sajter, och ser storleken fel ut ska
 * BASVARDET rattas i bannerns `style.css` - da nar andringen alla sajter.
 * Satts vardet per sajt nar framtida basandringar aldrig fram.
 */
export const GEOMETRY_VARIABLES = new Set([
  "banner-width",
  "header-text-size",
  "body-text-size",
  "badge-text-size",
  "small-text-size",
  "icon-container-size",
  "space-xs",
  "space-sm",
  "space-md",
  "space-lg",
  "space-xl",
  "btn-line-height",
  "header-line-height",
]);
