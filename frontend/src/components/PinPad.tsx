import { useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";
import { PIN_LENGTH } from "@/lib/applock";

/** Pavé numérique pour saisir un code PIN. `onComplete` est appelé dès que le code est entier ; renvoie le résultat pour afficher une erreur. */
export function PinPad({
  onComplete,
  disabled = false,
  error,
  extra,
}: {
  onComplete: (pin: string) => void | Promise<void>;
  disabled?: boolean;
  error?: string | null;
  /** Bouton en bas à gauche du pavé (ex. empreinte). */
  extra?: React.ReactNode;
}) {
  const [pin, setPin] = useState("");
  const pinRef = useRef(""); // valeur à jour, sans effet de bord dans un « setState »
  const busy = useRef(false);

  function setBoth(v: string) {
    pinRef.current = v;
    setPin(v);
  }

  // Une erreur vide la saisie pour recommencer
  useEffect(() => {
    if (error) setBoth("");
  }, [error]);

  function press(d: string) {
    if (disabled || busy.current || pinRef.current.length >= PIN_LENGTH) return;
    setBoth(pinRef.current + d);
    if (pinRef.current.length === PIN_LENGTH) {
      const value = pinRef.current;
      busy.current = true;
      // petit délai : on voit le dernier point se remplir
      window.setTimeout(async () => {
        try {
          await onComplete(value);
        } finally {
          busy.current = false;
          setBoth("");
        }
      }, 120);
    }
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const keyClass = "flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card text-2xl font-semibold text-foreground transition active:scale-95 active:bg-secondary disabled:opacity-40";

  return (
    <div className="flex flex-col items-center">
      <div className="mb-3 flex gap-4" aria-label={`Code PIN : ${pin.length} chiffres sur ${PIN_LENGTH}`}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span key={i} className={`h-3.5 w-3.5 rounded-full border-2 transition-colors ${i < pin.length ? "border-primary bg-primary" : "border-muted-foreground/50"}`} />
        ))}
      </div>
      <p className={`mb-5 h-5 text-center text-sm ${error ? "text-destructive" : "text-transparent"}`} role="alert">{error || "."}</p>
      <div className="grid grid-cols-3 gap-4">
        {keys.map((k) => (
          <button key={k} type="button" disabled={disabled} onClick={() => press(k)} className={keyClass}>{k}</button>
        ))}
        <div className="flex h-16 w-16 items-center justify-center">{extra}</div>
        <button type="button" disabled={disabled} onClick={() => press("0")} className={keyClass}>0</button>
        <button type="button" disabled={disabled} aria-label="Effacer" onClick={() => !busy.current && setBoth(pinRef.current.slice(0, -1))} className="flex h-16 w-16 items-center justify-center rounded-full text-muted-foreground transition active:scale-95 disabled:opacity-40">
          <Delete className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
