import { redirect } from "next/navigation";

/** Legacy admin config — unified panel lives at /admin/config-v2. */
export default function AdminConfigRedirectPage() {
  redirect("/admin/config-v2");
}
