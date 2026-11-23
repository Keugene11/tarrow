import { redirect } from "next/navigation";

// Kept for old links and the native apps' start URL.
export default function HomeRedirect() {
  redirect("/c/new");
}
