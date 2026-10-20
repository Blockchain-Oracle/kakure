import localFont from "next/font/local";

/**
 * The games' pixel face (m6x11plus by Daniel Linssen, credited in the games' settings; `fonts/SOURCES.md`), loaded by
 * the `/games` layout only, so no other page fetches it. The arcade's full-screen layer portals out of the frame and
 * wears the variable itself.
 */
export const pixelFont = localFont({
  src: "./fonts/m6x11plus.ttf",
  variable: "--kakure-font-pixel",
  display: "swap",
});
