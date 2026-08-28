/**
 * Normaliserar en origin for jamforelse.
 *
 * En Origin-header fran en webblasare har aldrig avslutande snedstreck och
 * jamfors skiftlageslost. Databasrader och miljovariabler skrivs daremot for
 * hand, och da smyger det latt in ett "/" eller en versal.
 *
 * Anvands pa BADA sidor av varje jamforelse. Ligger den har i stallet for
 * lokalt i varje fil kan de tva kontrollerna - CORS i index.ts och
 * origin-kontrollen i routes/consent.ts - inte glida isar. Gjorde de det
 * skulle en slarvig rad passera CORS men avvisas med 403 av skrivningen, och
 * felet vore tyst: samtycket loggas aldrig och bannern aterkommer hos
 * besokaren varje timme.
 */
export function normalizeOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, "");
}
