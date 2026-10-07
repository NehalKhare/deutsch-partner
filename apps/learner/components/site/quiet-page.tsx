import { QuietShell } from "@dp/ui/quiet-shell";

import { CompactLegalFooter } from "@/components/site/public-footer";

/**
 * The quiet shell as this product wears it: with the legal links at the
 * foot. Every page a visitor passes through — signing in, signing up, the
 * authenticator, setting up, getting lost — uses this rather than the shell
 * itself, so none can forget the Impressum.
 */
export function QuietPage(props: Omit<React.ComponentProps<typeof QuietShell>, "footer">) {
  return <QuietShell {...props} footer={<CompactLegalFooter />} />;
}
