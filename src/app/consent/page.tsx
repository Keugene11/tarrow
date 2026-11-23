import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ConsentClient } from "./ConsentClient";

export const metadata = { title: "How Tarrow uses AI" };

export default async function ConsentPage() {
  const user = await requireUser();
  if (user.ai_consent_at) redirect("/c/new");
  return <ConsentClient next={"/c/new"} />;
}
