/** Coaches, the Pipeline and job/people finding are personal features for the owner's own account, not part of the public app. */
/** The owner's account email(s), comma-separated in OWNER_EMAILS. Must be an address only the owner can sign in as (verified via Google/Apple). */
export const PERSONAL_EMAILS = (process.env.OWNER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

/** Local QA only: PERSONAL_FEATURE_EMAILS=qa+personal@tarrow.test lets a test account see them too. Never set in production. */
const extra = () =>
  (process.env.PERSONAL_FEATURE_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.endsWith("@tarrow.test"));

export const hasPersonalFeatures = (user: { email: string } | null | undefined) => {
  const email = user?.email.toLowerCase();
  return !!email && (PERSONAL_EMAILS.includes(email) || extra().includes(email));
};
