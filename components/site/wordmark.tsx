import Link from "next/link";

/**
 * The name, in the display face, linking home.
 *
 * It appears in four layouts and the destination differs by one thing: signed
 * out it goes to the landing page, signed in it goes to the dashboard. Better
 * a prop than four people remembering.
 */
export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="rounded-sm font-display text-lg font-semibold tracking-tight text-chalk focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-apricot"
    >
      Deutsch Partner
    </Link>
  );
}
