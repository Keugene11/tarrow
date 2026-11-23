/** Tarrow's opening interview message. Shared so the logged-out screen shows exactly what the real interview starts with. */
export function interviewGreeting(name?: string | null) {
  const first = name ? name.split(" ")[0] : "there";
  return `Hey ${first}, I'm Tarrow. I work best when I actually know your life, so I'm going to ask you some questions first (about 5 minutes). Be as honest and specific as you want. It stays private, and you can edit anything I remember.\n\nLet's start simple: what does a normal day look like for you right now? Work, school, something else?`;
}

/** Areas the interview covers; progress is how many have a saved memory. Keep in sync with INTERVIEW_AREAS in agent/context.ts. */
export const INTERVIEW_TOPICS = [
  { key: "identity", label: "you" },
  { key: "work", label: "work" },
  { key: "money", label: "money" },
  { key: "goals", label: "goals" },
  { key: "blockers", label: "blockers" },
  { key: "people", label: "people" },
  { key: "health", label: "health" },
  { key: "interests", label: "interests" },
];
