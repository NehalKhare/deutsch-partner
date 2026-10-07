/**
 * Who runs this product, as the law requires it to be said.
 *
 * One record, read by the Impressum (§5 DDG), the privacy policy (Art. 13
 * GDPR names the controller), the terms (the contract partner) and the
 * withdrawal form (where a withdrawal is addressed). Said once so the four
 * pages cannot name three different addresses.
 *
 * Every value below is a placeholder until the operating entity is settled.
 * The placeholders are written in square brackets on purpose: a page that
 * prints "[Operator name]" cannot be mistaken for a finished Impressum, and
 * a test refuses to let a deployment index a legal page while one remains.
 */
export interface LegalEntity {
  /** The trading name, or the full name of a sole proprietor. */
  readonly name: string;
  /** Legal form, e.g. "Einzelunternehmen", "UG (haftungsbeschränkt)", "GmbH". */
  readonly legalForm: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly country: string;
  readonly email: string;
  /** A phone number or another way to reach the operator quickly (§5 DDG). */
  readonly phone: string;
  /** Who answers for the content (§18(2) MStV). Usually the owner. */
  readonly responsiblePerson: string;
  /** Commercial register and number, or null for an unregistered sole proprietor. */
  readonly register: { readonly court: string; readonly number: string } | null;
  /** The VAT id (USt-IdNr.), or null if none has been issued. */
  readonly vatId: string | null;
  /** The supervisory authority for data protection the operator falls under. */
  readonly supervisoryAuthority: { readonly name: string; readonly url: string };
}

export const LEGAL_ENTITY: LegalEntity = {
  name: "[Operator name]",
  legalForm: "[Legal form]",
  street: "[Street and number]",
  postalCode: "[Postal code]",
  city: "[City]",
  country: "Germany",
  email: "[contact email]",
  phone: "[phone number]",
  responsiblePerson: "[Responsible person]",
  register: null,
  vatId: null,
  supervisoryAuthority: {
    name: "[The data protection authority of the operator's federal state]",
    url: "https://www.bfdi.bund.de/DE/Service/Anschriften/Laender/Laender-node.html",
  },
};

/** Whether a value is still one of the bracketed placeholders above. */
export function isPlaceholder(value: string): boolean {
  return /^\[.*\]$/.test(value.trim());
}

/** Every placeholder still left in the record. Empty means the Impressum is real. */
export function unfilledFields(entity: LegalEntity = LEGAL_ENTITY): readonly string[] {
  const flat: Record<string, string> = {
    name: entity.name,
    legalForm: entity.legalForm,
    street: entity.street,
    postalCode: entity.postalCode,
    city: entity.city,
    country: entity.country,
    email: entity.email,
    phone: entity.phone,
    responsiblePerson: entity.responsiblePerson,
    supervisoryAuthority: entity.supervisoryAuthority.name,
    ...(entity.register ? { registerCourt: entity.register.court, registerNumber: entity.register.number } : {}),
    ...(entity.vatId ? { vatId: entity.vatId } : {}),
  };
  return Object.entries(flat)
    .filter(([, value]) => isPlaceholder(value))
    .map(([key]) => key);
}

/** The postal address on one line, for the withdrawal form and the footer of a notice. */
export function postalAddress(entity: LegalEntity = LEGAL_ENTITY): string {
  return `${entity.name}, ${entity.street}, ${entity.postalCode} ${entity.city}, ${entity.country}`;
}
