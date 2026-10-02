import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export type Theme = "dark" | "light";

const THEME_KEY = "kalchat_theme";
const THEME_COLORS: Record<Theme, string> = { dark: "#17112a", light: "#fbfaff" };

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* stockage indisponible : le thème reste valable pour cette session */
  }
}

interface ThemeValue {
  theme: Theme;
  setTheme: (theme: Theme) => Promise<void>;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

/** Thème clair / sombre (sombre par défaut). Mémorisé sur l'appareil et sur le compte du membre. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // À la connexion (ou sur un nouvel appareil), on reprend le thème enregistré sur le compte.
  useEffect(() => {
    if (profile?.theme) setThemeState(profile.theme);
  }, [profile?.id, profile?.theme]);

  const setTheme = useCallback(
    async (next: Theme) => {
      const previous = theme;
      if (next === previous) return;
      setThemeState(next); // changement immédiat à l'écran
      if (!profile) return;
      try {
        await api("/users/me/settings", { method: "PATCH", body: { theme: next } });
      } catch (e) {
        setThemeState(previous);
        toast.error((e as Error).message);
      }
    },
    [theme, profile],
  );

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme doit être utilisé dans ThemeProvider");
  return ctx;
}
