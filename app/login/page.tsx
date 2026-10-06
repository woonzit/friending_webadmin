import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import AdminMembershipUnavailable from "@/components/AdminMembershipUnavailable";
import { adminMe, AdminMembershipUnconfirmedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  let me;
  try { me = await adminMe(); } catch (error) {
    if (error instanceof AdminMembershipUnconfirmedError) return <AdminMembershipUnavailable checkId={crypto.randomUUID()} />;
    throw error;
  }
  if (me) redirect("/");
  return <LoginForm />;
}
