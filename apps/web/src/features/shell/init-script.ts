import { STORAGE_KEYS } from "@/constants";

/**
 * Runs in <head> before first paint: puts the stored network and theme on <html> so no world or theme flashes
 * (Mitoshi THEME_INIT_SCRIPT, lib/theme.ts). Dark unless the stored choice, or the OS with no stored choice, asks for
 * light; the server renders `class="dark"` so a page without scripts is dark too. Reads this device's storage only.
 */
export const INIT_SCRIPT = `(function(){var d=document.documentElement;try{var n=localStorage.getItem("${STORAGE_KEYS.network}");d.dataset.network=n==="mainnet"?"mainnet":"testnet";var t=localStorage.getItem("${STORAGE_KEYS.theme}");t=t==="light"||t==="dark"?t:"system";d.dataset.themeMode=t;var l=t==="light"||(t==="system"&&matchMedia("(prefers-color-scheme: light)").matches);d.classList.toggle("dark",!l);var p=JSON.parse(localStorage.getItem("${STORAGE_KEYS.prefs}")||"{}");if(p.motion==="reduce")d.dataset.motion="reduce"}catch(e){d.dataset.network="testnet"}})();`;
