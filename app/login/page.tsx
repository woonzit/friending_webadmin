import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { adminMe } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await adminMe()) redirect("/");
  return <LoginForm />;
}
