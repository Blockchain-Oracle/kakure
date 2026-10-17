import { STORAGE_KEYS } from "@/constants";

/**
 * Runs in <head> before first paint: puts the stored network and theme on <html> so the four themes never flash
 * (Owarine's THEME_INIT_SCRIPT, owarine.md §4). Reads this device's storage only.
 */
export const INIT_SCRIPT = `(function(){var d=document.documentElement;try{var n=localStorage.getItem("${STORAGE_KEYS.network}");d.dataset.network=n==="mainnet"?"mainnet":"testnet";var t=localStorage.getItem("${STORAGE_KEYS.theme}");t=t==="light"||t==="dark"?t:"system";d.dataset.themeMode=t;if(t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches))d.classList.add("dark")}catch(e){d.dataset.network="testnet"}})();`;
