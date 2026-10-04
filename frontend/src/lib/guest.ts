/** Invitation à se connecter, affichée quand un visiteur essaie d'interagir (liker, commenter, écrire…). */
export const GUEST_PROMPT_EVENT = "kalchat:guest-prompt";

export type GuestReason = "like" | "comment" | "share" | "save" | "create" | "message" | "profile" | "explore" | "search" | "generic";

export function openGuestPrompt(reason: GuestReason = "generic") {
  window.dispatchEvent(new CustomEvent<GuestReason>(GUEST_PROMPT_EVENT, { detail: reason }));
}
