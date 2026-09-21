/**
 * Lagger in bannertaggen i en sida som annu saknar den - for designpanelen.
 *
 * Panelen visar bannern pa kundens riktiga sajt. Fore lansering finns ingen
 * banner dar, och darfor blev designgodkannandet skarmbilder (2026-09-21).
 * Med den har funktionen lagger panelen in taggen i sitt EGET fonster, sa att
 * designen kan godkannas innan kundens kod ens ar pushad. Sajten rors aldrig.
 *
 * Har sidan redan bannern lamnas den orord: efter lansering ska panelen visa
 * exakt det besokaren far.
 *
 * Vakten laggs INTE in. Den paverkar inte utseendet, och panelen avbryter
 * anda alla skrivningar till bevisloggen.
 */

export const BANNER_SRC = "https://seos-cookie-banner.vercel.app/v1/banner.js";

// Nyckeln skrivs in i ett HTML-attribut. Formatet ar alltid pk_live_ + hex,
// sa allt annat - sarskilt citattecken - vagras hellre an escapas.
const SITE_KEY_FORMAT = /^pk_live_[a-f0-9]+$/;

export function injectBanner(html: string, siteKey: string): { html: string; injected: boolean } {
  if (!SITE_KEY_FORMAT.test(siteKey)) {
    throw new Error(`Ogiltig site key: ${siteKey}`);
  }

  if (html.includes("/v1/banner.js")) return { html, injected: false };

  const tag = `<script src="${BANNER_SRC}" data-site-key="${siteKey}" async></script>`;

  // Sista </body>, skiftlageslost. Saknas den accepterar webblasaren anda
  // sidan - taggen hamnar da sist.
  const close = html.toLowerCase().lastIndexOf("</body>");
  if (close === -1) return { html: html + tag, injected: true };

  return { html: html.slice(0, close) + tag + html.slice(close), injected: true };
}
