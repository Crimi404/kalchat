import { Search, Bell, LogOut, Settings, Shield, User as UserIcon, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import logo from "@/assets/kalchat-logo.png";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { searchUsers } from "@/lib/social";
import { BadgeList } from "@/components/KalBadge";
import { openGuestPrompt } from "@/lib/guest";

function AccountMenu() {
  const { user, profile, loading, isStaff, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (loading) return <span className="h-9 w-9 animate-pulse rounded-full bg-secondary" />;

  if (!user) {
    return (
      <Link
        to="/auth"
        className="brand-gradient rounded-full px-4 py-2 text-xs font-semibold text-primary-foreground"
      >
        Se connecter
      </Link>
    );
  }

  async function handleSignOut() {
    setOpen(false);
    await queryClient.cancelQueries();
    await signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="relative">
      <button
        aria-label="Mon compte"
        onClick={() => setOpen((v) => !v)}
        className="story-ring rounded-full p-[2px]"
      >
        {profile?.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt={profile.display_name}
            className="h-8 w-8 rounded-full border-2 border-background object-cover"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-secondary">
            <UserIcon className="h-4 w-4 text-muted-foreground" />
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            aria-label="Fermer le menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
            <div className="border-b border-border px-4 py-3">
              <p className="truncate text-sm font-semibold text-foreground">
                {profile?.display_name ?? "Mon compte"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                @{user.username}
              </p>
            </div>
            <Link
              to="/profil"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-3 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <UserIcon className="h-4 w-4" /> Mon profil
            </Link>
            <Link
              to="/parametres"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-3 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <Settings className="h-4 w-4" /> Paramètres
            </Link>
            {isStaff && (
              <Link to="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-3 text-sm text-foreground transition-colors hover:bg-secondary">
                <Shield className="h-4 w-4" /> Administration
              </Link>
            )}
            <button
              onClick={handleSignOut}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-destructive transition-colors hover:bg-secondary"
            >
              <LogOut className="h-4 w-4" /> Se déconnecter
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function NotifBell() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["notifUnread", user?.id],
    enabled: !!user,
    refetchInterval: 30000,
    queryFn: async () => (await api<{ count: number }>("/notifications/unread-count")).count,
  });
  if (!user) return null;
  return (
    <Link to="/notifications" aria-label="Notifications" className="relative rounded-full p-2 text-foreground transition-colors hover:bg-secondary">
      <Bell className="h-5 w-5" />
      {!!q.data && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-like ring-2 ring-background" />}
    </Link>
  );
}

function SearchPanel({ onClose }: { onClose: () => void }) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  const results = useQuery({ queryKey: ["userSearch", debounced], queryFn: () => searchUsers(debounced), enabled: debounced.length > 0 });

  return (
    <div className="absolute inset-x-0 top-full z-40 border-b border-border bg-background/98 px-4 pb-3 pt-2 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Rechercher un membre…"
          className="w-full rounded-xl border border-border bg-secondary/60 px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-secondary" aria-label="Fermer la recherche">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 max-h-80 overflow-y-auto">
        {results.isLoading && debounced && <p className="py-3 text-center text-xs text-muted-foreground">Recherche…</p>}
        {results.data?.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">Aucun membre trouvé.</p>}
        {results.data?.map((m) => (
          <Link key={m.id} to="/u/$username" params={{ username: m.username }} onClick={onClose} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-secondary">
            {m.avatar_url ? (
              <img src={m.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-primary-foreground">{m.display_name.slice(0, 1).toUpperCase()}</span>
            )}
            <div className="min-w-0">
              <p className="flex items-center gap-1 truncate text-sm font-semibold">{m.display_name}<BadgeList badges={m.badges} size={14} /></p>
              <p className="truncate text-xs text-muted-foreground">@{m.username}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const [searching, setSearching] = useState(false);
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <img src={logo} alt="Kalchat" className="h-9 w-9" width={36} height={36} />
        <div>
          <h1 className="font-display text-lg font-bold leading-tight text-foreground">{title}</h1>
          {subtitle && <p className="text-[11px] leading-tight text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button aria-label="Rechercher" onClick={() => (user ? setSearching((v) => !v) : openGuestPrompt("search"))} className="rounded-full p-2 text-foreground transition-colors hover:bg-secondary">
          <Search className="h-5 w-5" />
        </button>
        <NotifBell />
        <AccountMenu />
      </div>
      {searching && <SearchPanel onClose={() => setSearching(false)} />}
    </header>
  );
}
