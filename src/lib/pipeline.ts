/** Pipeline statuses, shared by the API and the Pipeline page. */
export const PERSON_STATUSES = [
  { value: "to_contact", label: "to contact" },
  { value: "contacted", label: "contacted" },
  { value: "replied", label: "replied" },
  { value: "meeting", label: "meeting" },
  { value: "closed", label: "closed" },
] as const;

export const JOB_STATUSES = [
  { value: "new", label: "new" },
  { value: "applied", label: "applied" },
  { value: "interviewing", label: "interviewing" },
  { value: "offer", label: "offer" },
  { value: "skipped", label: "skipped" },
] as const;

export const isPersonStatus = (s: unknown) => PERSON_STATUSES.some((x) => x.value === s);
export const isJobStatus = (s: unknown) => JOB_STATUSES.some((x) => x.value === s);

/** One-tap routines offered on the Pipeline page. */
export const PIPELINE_ROUTINES = [
  {
    title: "Daily job hunt",
    prompt:
      "Set up a daily routine: every morning, use find_jobs to find new roles that fit me (based on my resume, goals and city, plus remote), rank them honestly by fit, and save the best 5-8 to my pipeline with a fit score, why it fits and a short tailored pitch. For the top 2, find_people a founder, hiring manager or recruiter there and save them with a referral DM. End with a 3-line summary.",
  },
  {
    title: "Weekly founder outreach",
    prompt:
      "Set up a weekly routine for Monday: find 8 founders or operators worth reaching out to for my current goals (startup advice, a job, co-founders, customers or investors, whatever fits me best right now), skip anyone already in my pipeline, and save them with why and a personalized DM under 90 words each.",
  },
];
