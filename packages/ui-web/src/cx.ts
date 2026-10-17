/** Joins class names, skipping falsy parts (a tiny clsx; the kit avoids tailwind-merge to stay small). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
