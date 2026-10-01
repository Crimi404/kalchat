import { Image, CircleDot, Type, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

const options = [
  { icon: Image, label: "Photo", sub: "Publier", soon: false },
  { icon: Type, label: "Texte", sub: "Écrire un post", soon: false },
  { icon: CircleDot, label: "Story", sub: "24 h", soon: true },
];

export function CreateMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-sheet-up relative w-full max-w-md rounded-t-3xl border-t border-border bg-card p-6 pb-10">
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-muted" />
        <div className="grid grid-cols-3 gap-3">
          {options.map((opt) => (
            <button
              key={opt.label}
              onClick={() => {
                onClose();
                if (opt.soon) navigate({ to: "/story" });
                else navigate({ to: "/nouveau" });
              }}
              className="flex flex-col items-center gap-2 rounded-2xl bg-secondary/60 px-2 py-4 transition-transform active:scale-95 hover:bg-secondary"
            >
              <span className="brand-gradient flex h-11 w-11 items-center justify-center rounded-full text-primary-foreground">
                <opt.icon className="h-5 w-5" />
              </span>
              <span className="text-xs font-semibold text-foreground">{opt.label}</span>
              <span className="text-[10px] text-muted-foreground">{opt.sub}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-secondary py-3 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-accent"
        >
          <X className="h-4 w-4" /> Annuler
        </button>
      </div>
    </div>
  );
}
