import { Users } from "lucide-react";

/** Petit avatar rond : photo si elle existe, sinon l'initiale (ou une icône de groupe). */
export function MiniAvatar({ url, name, size = 40, group = false }: { url?: string | null; name: string; size?: number; group?: boolean }) {
  const box = { width: size, height: size };
  if (url) return <img src={url} alt={name} style={box} className="shrink-0 rounded-full object-cover" />;
  return (
    <span style={box} className="brand-gradient flex shrink-0 items-center justify-center rounded-full font-bold text-primary-foreground">
      {group ? <Users style={{ width: size * 0.5, height: size * 0.5 }} /> : <span style={{ fontSize: size * 0.4 }}>{(name || "?").slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}
