import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { ProfileView } from "@/components/ProfileView";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/profil")({
  head: () => ({
    meta: [
      { title: "Mon profil — Kalchat" },
      { name: "description", content: "Ton profil Kalchat : ta vibe, tes publications, ta communauté." },
      { property: "og:title", content: "Mon profil — Kalchat" },
      { property: "og:description", content: "Ton profil Kalchat : ta vibe, tes publications, ta communauté." },
    ],
  }),
  component: ProfilPage,
});

function ProfilPage() {
  const { profile } = useAuth();
  return (
    <div className="app-shell">
      <TopBar title="Profil" subtitle={profile ? `@${profile.username}` : ""} />
      <main className="pb-28">{profile && <ProfileView username={profile.username} />}</main>
      <BottomNav />
    </div>
  );
}
