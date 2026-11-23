import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { GuestChat } from "@/components/GuestChat";
import { AppShell } from "@/components/AppShell";

// Tarrow opens straight into the chat. Logged-out visitors can type; sending asks them to sign in.
export default async function Root() {
  const user = await currentUser();
  if (!user)
    return (
      <AppShell userName={null}>
        <GuestChat />
      </AppShell>
    );
  redirect("/c/new");
}
