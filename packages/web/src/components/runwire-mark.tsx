/**
 * The Runwire "Trace" mark: three rounded bars. Renders inline (rather than as an
 * `<img>`) so it inherits `currentColor` and needs no light/dark flip hack.
 */
export function RunwireMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" className={className}>
      <rect x="8" y="11" width="48" height="10" rx="5" />
      <rect x="20" y="27" width="22" height="10" rx="5" />
      <rect x="34" y="43" width="22" height="10" rx="5" />
    </svg>
  );
}
