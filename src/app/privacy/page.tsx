import { LegalPage } from "@/components/LegalPage";
import { SUPPORT_EMAIL } from "@/lib/contact";

export const metadata = { title: "Privacy Policy" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>Last updated September 18, 2026. This policy covers the Tarrow website and the Tarrow iOS and Android apps.</p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> name, email address, city (optional), timezone, and a password hash if you use email sign-in. If you use Sign in with Apple or Google, we receive only your name, email (which may be an Apple private relay address) and an account identifier from them.
        </li>
        <li>
          <strong>What you share with Tarrow:</strong> your messages, interview answers, and what Tarrow saves for you: memories, your &quot;life file&quot; summary, goals, tasks, routines, documents and drafts.
        </li>
        <li>
          <strong>Device data for notifications:</strong> if you turn notifications on, a push token for your device or browser.
        </li>
        <li>
          <strong>Basic usage counts</strong> (for example, tasks per day) to enforce limits. We don&apos;t use analytics or advertising SDKs, and we don&apos;t track you across apps or websites.
        </li>
        <li>
          <strong>Voice:</strong> if you use the microphone, the recording is transcribed and then discarded. We don&apos;t keep audio.
        </li>
        <li>
          <strong>Gmail (optional):</strong> if you connect Gmail in Settings, we store an encrypted token that lets Tarrow, only when you ask it to, search and read your email and create drafts in your Gmail. Tarrow never sends email by itself: you review each draft and tap Send. Email content Tarrow reads for a request is sent to the AI provider answering that request and is kept only as part of that chat&apos;s transcript, which you can delete. Disconnect at any time in Settings; we then delete the token and revoke Tarrow&apos;s access with Google. Tarrow&apos;s use of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>Only to provide Tarrow to you: to answer your requests, research things for you, remember context about your life, send notifications you asked for, and keep your account secure. We do not sell your data or use it for advertising.</p>

      <h2>Third parties that process your data</h2>
      <p>We ask for your explicit permission before any of your personal data is sent to third-party AI. You can withdraw it in Settings → AI &amp; data sharing.</p>
      <ul>
        <li>
          <strong>AI model providers:</strong> OpenRouter, which routes requests to Z.ai (GLM models) or DeepSeek, and Groq as a backup. Relevant parts of your conversation, memories, name and city are sent to generate replies. We only route to hosts that don&apos;t retain prompts or train on them. Groq also transcribes voice input.
        </li>
        <li>
          <strong>Web research:</strong> search queries Tarrow writes are sent to search providers, pages are fetched from the websites being read, place lookups go to Google Maps Platform, and weather to Open-Meteo.
        </li>
        <li>
          <strong>Infrastructure:</strong> Vercel (hosting) and Neon (database), Apple Push Notification service and web push services (notifications), Apple and Google (sign-in).
        </li>
      </ul>
      <p>These providers process data only to deliver the service to you, and are required to protect it with the same or equal protection as described in this policy.</p>

      <h2>Retention and deletion</h2>
      <p>We keep your data while your account is active. You can view, edit and delete any memory on the Memory page, delete individual chats, goals, routines and documents, and delete your whole account in Settings → Delete account. Deleting your account permanently removes your data from our database immediately. Short-lived copies in backups and provider logs are removed within 30 days.</p>

      <h2>Your choices</h2>
      <ul>
        <li>Withdraw AI data-sharing permission any time in Settings (Tarrow can&apos;t answer without it).</li>
        <li>Turn notifications off in Settings or your device settings.</li>
        <li>Request a copy of your data or ask any privacy question by emailing us.</li>
      </ul>

      <h2>Children</h2>
      <p>Tarrow is not intended for anyone under 16.</p>

      <h2>Security</h2>
      <p>Passwords are hashed with scrypt, sessions use secure cookies, and all data is transmitted over HTTPS.</p>

      <h2>Contact</h2>
      <p>{SUPPORT_EMAIL}</p>
    </LegalPage>
  );
}
