import { api } from "@/lib/api";

// ---------- Membre connecté : vérifier son adresse email ----------
export interface EmailStatus {
  /** Le service d'envoi d'emails est-il activé pour moi ? */
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

// ---------- Visiteur : inscription avec code, mot de passe oublié ----------
export interface AuthConfig {
  /** L'inscription se fait-elle avec un code reçu par email ? */
  email_signup: boolean;
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  return api<AuthConfig>("/auth/config");
}

export interface SignupData {
  first_name: string;
  last_name: string;
  username: string;
  password: string;
  email: string;
  avatar_url: string | null;
}

export async function registerStart(data: SignupData): Promise<void> {
  await api("/auth/register/start", { method: "POST", body: data });
}

export async function registerResend(email: string): Promise<void> {
  await api("/auth/register/resend", { method: "POST", body: { email } });
}

export async function registerVerify(email: string, code: string): Promise<{ token: string }> {
  return api<{ token: string }>("/auth/register/verify", { method: "POST", body: { email, code } });
}

/** Envoie un code de réinitialisation. La réponse est toujours la même, que le compte existe ou non. */
export async function forgotPassword(identifier: string): Promise<void> {
  await api("/auth/forgot", { method: "POST", body: { identifier } });
}

export async function resetPassword(identifier: string, code: string, password: string): Promise<{ token: string }> {
  return api<{ token: string }>("/auth/reset", { method: "POST", body: { identifier, code, password } });
}
