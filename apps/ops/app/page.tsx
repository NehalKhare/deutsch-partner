import { redirect } from "next/navigation";

import { HOME_PATH } from "@/lib/auth/routes";

/** The spend is the front page. The proxy has already sent the signed-out to sign in. */
export default function IndexPage() {
  redirect(HOME_PATH);
}
