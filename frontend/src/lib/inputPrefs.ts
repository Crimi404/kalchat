import { useEffect, useState } from "react";

// « Entrée pour envoyer » : désactivé par défaut partout. La touche Entrée passe alors à la ligne,
// et on envoie avec le bouton (comme dans les autres messageries). Réglage gardé sur l'appareil.
const KEY = "kalchat_enter_to_send_v1";
const EVENT = "kalchat:enter-to-send";

export function getEnterToSend(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setEnterToSend(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* stockage indisponible */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function useEnterToSend(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(getEnterToSend);
  useEffect(() => {
    const sync = () => setOn(getEnterToSend());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [on, setEnterToSend];
}
