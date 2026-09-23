/**
 * What to call the person who is signed in.
 *
 * There is no name to use. The profile records how somebody learns — their
 * level, their goal, their interests — and never who they are, so the only
 * identity in the system is the address they signed in with.
 *
 * So the address is what gets shown, and its local part is what fits in a nav
 * bar. Not prettified into a name: turning "n.khare" into "N Khare" is a guess
 * about a real person that the product has no basis for, and being addressed
 * by a wrong name is worse than being addressed by your own handle. The full
 * address is in the menu, which is where somebody checks *which* account they
 * are actually in.
 */

/** When there is no address at all — a session shape we should still render. */
export const ANONYMOUS_LABEL = "Account";

export function accountLabel(email: string | null | undefined): string {
  const address = email?.trim() ?? "";
  if (address.length === 0) return ANONYMOUS_LABEL;

  // Something that is not an address is still somebody's identity; show it
  // rather than deciding they are anonymous — and note that slicing to a
  // lastIndexOf of -1 would quietly drop their last character instead.
  const at = address.lastIndexOf("@");
  if (at < 0) return address;

  const local = address.slice(0, at);

  return local.length > 0 ? local : address;
}
