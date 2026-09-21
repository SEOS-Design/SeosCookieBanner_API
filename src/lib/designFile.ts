/**
 * Designfilen: lasa, skriva och rakna kontrast.
 *
 * `design/<kund>.css` ar sanningen, databasen ar kopian - samma monster som
 * policies/ och texts/. Darfor gar allt via den har filen: designpanelen
 * skriver den, publish-design laser den.
 */

import { DESIGN_VARIABLES, GEOMETRY_VARIABLES } from "./designVariables";

// Samma sparr som i API:t: ett CSS-varde med url() far webblasaren att hamta
// nagot fran en adress vi inte valt, och de ovriga tecknen kan bryta sig ut ur
// vardet och bli egna regler.
const UNSAFE_VALUE = /url\(|expression\(|javascript:|@import|[<>{}\\;]/i;
const MAX_VALUE_LENGTH = 200;

/**
 * Plockar ut CSS-variabler ur en fil. Medvetet enkelt: allt utom
 * `--namn: varde;` ignoreras. Kommentarer tas bort forst - designfilerna ar
 * fulla av dem, och flera innehaller bortkommenterade varden.
 */
export function parseVariables(css: string): Record<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Record<string, string> = {};

  const pattern = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutComments)) !== null) {
    const name = match[1]!.trim();
    // Radbrytningar och dubbla mellanslag plattas ut - ett varde far spanna
    // flera rader i filen men ska lagras som en rad.
    const value = match[2]!.replace(/\s+/g, " ").trim();
    found[name] = value;
  }
  return found;
}

/**
 * Skriver om varden till en designfil.
 *
 * Vagrar hellre an skriver nagot publiceringen sedan hoppar over: da ser det
 * ut som att andringen tog, men kundens banner ar orord.
 */
export function toDesignCss(
  values: Record<string, string>,
  options: { title: string; note?: string },
): string {
  const rows: string[] = [];

  for (const [name, value] of Object.entries(values)) {
    if (GEOMETRY_VARIABLES.has(name)) {
      throw new Error(
        `--${name}: geometri gar inte att satta per sajt. Bannern ska kannas som ` +
          `samma komponent pa alla sajter - ratta basvardet i bannerns style.css.`,
      );
    }
    if (!DESIGN_VARIABLES.has(name)) {
      throw new Error(`--${name}: okand designvariabel.`);
    }
    if (value.length > MAX_VALUE_LENGTH) {
      throw new Error(`--${name}: vardet ar langre an ${MAX_VALUE_LENGTH} tecken.`);
    }
    if (UNSAFE_VALUE.test(value)) {
      throw new Error(
        `--${name}: vardet innehaller nagot som inte hor hemma i en CSS-variabel ` +
          `(url(), @import, javascript: eller tecken som bryter ut ur vardet).`,
      );
    }
    rows.push(`  --${name}: ${value};`);
  }

  const header = [
    "/* " + options.title,
    " *",
    " * Skriven av npm run design. Vardena avviker fran bannerns basvarden -",
    " * allt som inte star har kommer fran banner-src/style.css.",
    ...(options.note ? [" *", ...options.note.split("\n").map((line) => ` * ${line}`)] : []),
    " */",
  ].join("\n");

  return `${header}\n\n:root {\n${rows.join("\n")}\n}\n`;
}

/**
 * Kontrast mellan tva farger, enligt WCAG 2.1.
 *
 * Returnerar null nar vardet inte ar en farg vi kan rakna pa - ett typsnitt,
 * en radie, eller `var(--sajtens-egen)`. Panelen ska da visa ingenting hellre
 * an en siffra som inte betyder nagot.
 */
export function contrastRatio(a: string, b: string): number | null {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  if (first === null || second === null) return null;

  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG:s grans for vanlig brodtext. */
export const CONTRAST_MINIMUM = 4.5;

function relativeLuminance(color: string): number | null {
  const rgb = toRgb(color);
  if (!rgb) return null;

  const [r, g, b] = rgb.map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Tar #rgb och #rrggbb. Designfilerna innehaller bada, skrivna for hand. */
function toRgb(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, "");

  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const [r, g, b] = hex.split("") as [string, string, string];
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}
