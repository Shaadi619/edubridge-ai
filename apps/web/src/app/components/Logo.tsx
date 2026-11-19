/**
 * EduBridge brand marks from docs/brand. The wordmark's gold stroke bridges the
 * "u" and the "B". Below about 140px wide, use the monogram instead.
 */
const WORDMARK_RATIO = 1301 / 321;

export function Wordmark({ tone = "dark", width = 148, className = "" }: {
  /** "dark" for navy or slate backgrounds, "light" for light ones. */
  tone?: "dark" | "light";
  width?: number;
  className?: string;
}) {
  return (
    <img
      src={tone === "dark" ? "/brand/edubridge-wordmark-for-dark.svg" : "/brand/edubridge-wordmark-for-light.svg"}
      alt="EduBridge"
      width={width}
      height={Math.round(width / WORDMARK_RATIO)}
      className={`block select-none ${className}`}
      draggable={false}
    />
  );
}

export function Monogram({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <img src="/brand/edubridge-app-icon.svg" alt="EduBridge" width={size} height={size}
      className={`block select-none rounded-[22%] ${className}`} draggable={false} />
  );
}
