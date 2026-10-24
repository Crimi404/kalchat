/** Choix « aperçu public » demandé au moment où un membre partage ou copie le lien de SON profil / de SA publication. */
export const PREVIEW_CHOICE_EVENT = "kalchat:preview-choice";

export interface PreviewChoiceDetail {
  run: () => void;
}

/** Si le membre n'a pas encore activé l'aperçu public, on lui demande avant de partager ; sinon on partage directement. */
export function withPreviewChoice(needsChoice: boolean, run: () => void) {
  if (!needsChoice || typeof window === "undefined") {
    run();
    return;
  }
  window.dispatchEvent(new CustomEvent<PreviewChoiceDetail>(PREVIEW_CHOICE_EVENT, { detail: { run } }));
}
