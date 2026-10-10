import { createFileRoute } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { SettingsShell } from "@/components/SettingsShell";
import { ChatThemeEditor } from "@/components/ChatThemeEditor";
import { chatThemeSupported } from "@/lib/chatTheme";

export const Route = createFileRoute("/_authenticated/parametres/discussions")({
  head: () => ({ meta: [{ title: "Fond des discussions — Kalchat" }] }),
  component: DiscussionsPage,
});

function DiscussionsPage() {
  if (!chatThemeSupported()) {
    return (
      <SettingsShell title="Fond des discussions">
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <Palette className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-foreground">Disponible dans l'application Android</p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">Le fond personnalisé et la couleur des messages sont réservés à l'APK Kalchat.</p>
        </div>
      </SettingsShell>
    );
  }
  return (
    <SettingsShell title="Fond des discussions">
      <p className="px-1 text-sm leading-snug text-muted-foreground">Ce thème s'applique à toutes tes discussions. Tu peux aussi en choisir un différent pour une discussion précise, depuis son menu « ⋯ ».</p>
      <ChatThemeEditor scope={null} />
    </SettingsShell>
  );
}
