import { api } from "@/lib/api";

export interface EmailStatus {
  /** Le service d'envoi d'emails est-il activé sur le serveur ? */
  enabled: boolean;
  email: string | null;
  verified: boolean;
}

export async function fetchEmailStatus(): Promise<EmailStatus> {
  return api<EmailStatus>("/email/status");
}

/** Envoie un code à 6 chiffres à cette adresse (valable 15 minutes). */
export async function requestEmailCode(email: string): Promise<void> {
  await api("/email/request", { method: "POST", body: { email } });
}

export async function verifyEmailCode(code: string): Promise<{ email: string }> {
  return api<{ email: string }>("/email/verify", { method: "POST", body: { code } });
}
