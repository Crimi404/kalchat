import { Copy, Flag, Pencil, Pin, PinOff, Reply, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";

export interface MessageAction {
  id: string;
  label: string;
  icon: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

/** Menu qui s'ouvre après un appui long sur un message : répondre, copier, épingler, modifier, supprimer. */
export function MessageActionSheet({ preview, actions, onClose }: { preview: string; actions: MessageAction[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="animate-fade-in w-full max-w-md rounded-t-3xl border border-border bg-card pb-3 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button aria-label="Fermer" onClick={onClose} className="rounded-full p-2 hover:bg-secondary"><X className="h-5 w-5" /></button>
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{preview}</p>
        </div>
        <div className="px-2">
          {actions.map((a) => (
            <button
              key={a.id}
              onClick={() => { onClose(); a.onSelect(); }}
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left text-sm font-semibold transition-colors hover:bg-secondary ${a.danger ? "text-destructive" : "text-foreground"}`}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export const ActionIcons = {
  reply: <Reply className="h-5 w-5" />,
  copy: <Copy className="h-5 w-5" />,
  pin: <Pin className="h-5 w-5" />,
  unpin: <PinOff className="h-5 w-5" />,
  edit: <Pencil className="h-5 w-5" />,
  delete: <Trash2 className="h-5 w-5" />,
  report: <Flag className="h-5 w-5" />,
};
