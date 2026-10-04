import { Check, X } from "lucide-react";
import { useBackHandler } from "@/lib/back";

/** Feuille de choix (boutons radio) : sert pour la présence en ligne, les messages éphémères… */
export function ChoiceSheet<T extends string | number>({
  title,
  description,
  options,
  value,
  pending,
  onSelect,
  onClose,
}: {
  title: string;
  description?: string;
  options: { value: T; label: string; hint?: string }[];
  value: T;
  pending?: boolean;
  onSelect: (v: T) => void;
  onClose: () => void;
}) {
  useBackHandler(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="animate-fade-in w-full max-w-md rounded-t-3xl border border-border bg-card pb-4 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-3">
          <button aria-label="Fermer" onClick={onClose} className="rounded-full p-2 hover:bg-secondary"><X className="h-5 w-5" /></button>
          <h3 className="flex-1 font-bold text-foreground">{title}</h3>
        </div>
        {description && <p className="px-5 pb-2 text-xs leading-snug text-muted-foreground">{description}</p>}
        <div className="px-2">
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={String(o.value)}
                disabled={pending}
                onClick={() => onSelect(o.value)}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-secondary disabled:opacity-60"
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                  {selected && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">{o.label}</span>
                  {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
