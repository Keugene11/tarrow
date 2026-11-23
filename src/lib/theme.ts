// Light is the default theme. The preference lives in localStorage and is applied before paint by THEME_SCRIPT.
export type ThemePref = "light" | "dark" | "system";

const KEY = "tarrow_theme";
export const THEME_COLORS = { light: "#ffffff", dark: "#0b0b0b" } as const;

// Inlined into <head>; keep it dependency-free and in sync with applyTheme below.
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("${KEY}")||"light";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var t=d?"dark":"light";document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?"${THEME_COLORS.dark}":"${THEME_COLORS.light}");}catch(e){}})();`;

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "system" || v === "light") return v;
  } catch {}
  return "light";
}

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "system") return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return pref;
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const theme = resolveTheme(pref);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  window.dispatchEvent(new CustomEvent("tarrow-theme", { detail: theme }));
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {}
  applyTheme(pref);
}
