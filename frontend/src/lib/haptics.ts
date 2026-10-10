import { isInsideApp } from "@/lib/apk";

type HapticsPlugin = { impact: (o: { style: "LIGHT" | "MEDIUM" | "HEAVY" }) => Promise<void> };

/** Petite vibration quand on aime une publication / un commentaire (APK uniquement ; sans effet ailleurs). */
export function likeBuzz() {
  if (!isInsideApp()) return;
  try {
    const haptics = (window as unknown as { Capacitor?: { Plugins?: { Haptics?: HapticsPlugin } } }).Capacitor?.Plugins?.Haptics;
    if (haptics?.impact) {
      void haptics.impact({ style: "LIGHT" }).catch(() => undefined);
    } else {
      navigator.vibrate?.(12); // ancienne APK sans le module de vibrations
    }
  } catch {
    /* vibrations indisponibles : sans conséquence */
  }
}
