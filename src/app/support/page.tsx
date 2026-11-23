import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { SUPPORT_EMAIL } from "@/lib/contact";

export const metadata = { title: "Support" };

export default function Support() {
  return (
    <LegalPage title="Support">
      <p>Need help with Tarrow? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we&apos;ll get back to you within 2 business days.</p>

      <h2>Common questions</h2>
      <h3>How do I delete my account?</h3>
      <p>Open Settings (or type /settings in the chat) → Delete account. Everything is removed permanently.</p>
      <h3>How do I change what Tarrow remembers?</h3>
      <p>Open Memory (/memory). You can edit or delete any fact, and refresh your life file.</p>
      <h3>How do I get notified when a long task finishes?</h3>
      <p>While a task is running, tap &quot;Notify me when it&apos;s done&quot;, or turn notifications on in Settings.</p>
      <h3>Tarrow got something wrong.</h3>
      <p>Tarrow is an AI and can make mistakes. Check important details yourself, and never rely on it for medical, legal or financial decisions. Tell us what happened by email so we can improve it.</p>
      <h3>How is my data used?</h3>
      <p>
        See the <Link href="/privacy">Privacy Policy</Link>. You can withdraw AI data-sharing permission in Settings at any time.
      </p>
    </LegalPage>
  );
}
