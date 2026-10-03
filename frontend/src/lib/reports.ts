import { api } from "@/lib/api";

export type ReportTarget = "post" | "comment" | "message" | "user";

export const REPORT_REASONS: { value: string; label: string; hint?: string }[] = [
  { value: "spam", label: "Spam ou publicité", hint: "Contenu répétitif, liens douteux, faux comptes" },
  { value: "harcelement", label: "Harcèlement ou intimidation", hint: "Insultes, menaces, acharnement" },
  { value: "haine", label: "Haine ou discrimination", hint: "Propos visant une origine, une religion, un genre…" },
  { value: "violence", label: "Violence ou contenu choquant" },
  { value: "nudite", label: "Nudité ou contenu sexuel" },
  { value: "usurpation", label: "Usurpation d'identité", hint: "Quelqu'un se fait passer pour une autre personne" },
  { value: "arnaque", label: "Arnaque ou escroquerie" },
  { value: "autre", label: "Autre raison" },
];

export const REPORT_REASON_LABEL: Record<string, string> = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]));

export async function sendReport(input: { type: ReportTarget; targetId: string; reason: string; details?: string }) {
  await api("/reports", {
    method: "POST",
    body: { type: input.type, target_id: input.targetId, reason: input.reason, details: input.details?.trim() || undefined },
  });
}

/** Masque une publication de mon fil (« Cela ne m'intéresse pas »). */
export async function hidePost(postId: string) {
  await api(`/posts/${postId}/hide`, { method: "POST" });
}

export async function unhidePost(postId: string) {
  await api(`/posts/${postId}/hide`, { method: "DELETE" });
}
