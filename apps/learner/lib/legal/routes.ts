/**
 * Where the legal pages live.
 *
 * Their own module, with no imports, because the footer that links to them is
 * rendered on every page, including the sign-in card, and must not pull the
 * billing catalogue into the bundle to learn four paths.
 */
export const IMPRESSUM_PATH = "/legal/impressum";
export const PRIVACY_PATH = "/legal/privacy";
export const TERMS_PATH = "/legal/terms";
export const WITHDRAWAL_PATH = "/legal/withdrawal";
/** The §312k BGB cancellation button's destination. Public: it works without signing in. */
export const CANCEL_CONTRACT_PATH = "/legal/cancel";
/** The §356a BGB withdrawal button's destination. Behind sign-in: an account was needed to contract. */
export const WITHDRAW_PATH = "/billing/withdraw";

/** The version of the privacy policy, stated on the page. Bump when the policy's substance changes. */
export const PRIVACY_VERSION = "2026-10-07";
