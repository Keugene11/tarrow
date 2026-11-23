import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Log in" };

export default async function LoginPage() {
  const user = await currentUser();
  // Guests can still sign up or log in; their interview and chats move to that account.
  if (user && !user.is_guest) redirect("/c/new");
  return <AuthForm guest={!!user} mode="login" />;
}
