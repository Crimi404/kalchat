import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { BottomNav } from "@/components/BottomNav";

/** Cadre d'une sous-page des Paramètres : flèche retour + titre. */
export function SettingsShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/90 px-3 py-3 backdrop-blur-xl">
        <Link to="/parametres" aria-label="Retour aux paramètres" className="rounded-full p-2 hover:bg-secondary"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="text-base font-bold text-foreground">{title}</h1>
      </header>
      <main className="space-y-4 px-4 pb-28 pt-4">{children}</main>
      <BottomNav />
    </div>
  );
}

/** Ligne de réglage : titre + valeur / description en gris, comme dans WhatsApp ou X. */
export function SettingRow({
  title,
  description,
  icon: Icon,
  onClick,
  right,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  onClick?: () => void;
  right?: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-4 rounded-2xl px-2 py-3.5 text-left transition-colors hover:bg-secondary/60">
      {Icon && <Icon className="h-6 w-6 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>}
      </span>
      {right ?? (onClick ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : null)}
    </button>
  );
}
