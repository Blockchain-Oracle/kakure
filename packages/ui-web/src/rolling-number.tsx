import { cx } from "./cx";

/**
 * Rolling digits (Kawase: "money in condensed black figures that roll", kawase.md §4.2). A hand-rolled roller
 * instead of NumberFlow: each digit is a column of 0–9 that slides to its value over `number-change` (160 ms)
 * on the default curve; other characters sit still. Columns are keyed from the right so a figure that grows a
 * digit rolls instead of reshuffling. Reduced motion swaps the digits without travel. The full value is the
 * accessible name; the columns are hidden from assistive tech.
 */
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const STEP_PERCENT = 10;
const DIGIT = /\d/;
const NBSP = "\u00a0";

export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const chars = [...value];
  return (
    <span className={cx("inline-flex tabular-nums", className)} aria-label={value} role="img">
      {chars.map((char, index) => {
        const key = chars.length - index;
        if (!DIGIT.test(char)) {
          return (
            <span key={`c${key}`} aria-hidden className="inline-block whitespace-pre">
              {char === " " ? NBSP : char}
            </span>
          );
        }
        return (
          <span key={`d${key}`} aria-hidden className="relative inline-block h-[1lh] overflow-hidden">
            <span className="invisible">0</span>
            <span
              className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-(--duration-number-change) ease-default motion-reduce:transition-none"
              style={{ transform: `translateY(-${Number(char) * STEP_PERCENT}%)` }}
            >
              {DIGITS.map((digit) => (
                <span key={digit} className="block h-[1lh]">
                  {digit}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
