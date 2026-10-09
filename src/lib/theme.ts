export const THEME_STORAGE_KEY = "ceit-theme";

// Runs before first paint (inlined in <head>) so a returning dark-mode user
// never sees a flash of the light theme. Falls back to the OS preference.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
