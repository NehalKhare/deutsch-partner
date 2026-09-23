import { redirect } from "next/navigation";

/** The board is the front page. The proxy has already sent the signed-out to sign in. */
export default function IndexPage() {
  redirect("/product");
}
