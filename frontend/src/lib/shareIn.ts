import { useSyncExternalStore } from "react";

/**
 * Contenu reçu depuis le menu « Partager » d'Android (texte, lien, photo ou vidéo d'une autre appli).
 * - « choose » : la feuille « Partager vers Kalchat » est affichée ;
 * - « handed » : l'utilisateur a choisi Publier / Story, la page de destination récupère le contenu avec takePendingShare().
 */
export interface PendingShare {
  text: string;
  file: File | null;
  stage: "choose" | "handed";
}

let pending: PendingShare | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setPendingShare(next: { text: string; file: File | null }) {
  pending = { ...next, stage: "choose" };
  emit();
}

export function handOverShare() {
  if (pending) {
    pending = { ...pending, stage: "handed" };
    emit();
  }
}

export function clearPendingShare() {
  if (pending) {
    pending = null;
    emit();
  }
}

/** Récupère (une seule fois) le contenu confié à une page de destination, puis l'efface. */
export function takePendingShare(): { text: string; file: File | null } | null {
  if (!pending || pending.stage !== "handed") return null;
  const { text, file } = pending;
  pending = null;
  emit();
  return { text, file };
}

export function usePendingShare(): PendingShare | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    () => pending,
    () => null,
  );
}
