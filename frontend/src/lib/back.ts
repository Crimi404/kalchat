import { useEffect, useRef } from "react";

/**
 * Pile des « fermetures » actives (menus, feuilles, fenêtres) : le bouton retour d'Android
 * ferme d'abord la plus récente, avant de revenir à la page précédente.
 */
type Handler = () => void;
const stack: Handler[] = [];

/** Ferme l'élément ouvert le plus récent. Renvoie true s'il y en avait un. */
export function runBackHandler(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top();
  return true;
}

/** À appeler dans un menu / une feuille / une fenêtre : `handler` est exécuté quand on appuie sur retour. */
export function useBackHandler(handler: Handler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const entry: Handler = () => ref.current();
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [enabled]);
}
