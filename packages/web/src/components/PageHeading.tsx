import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export type PageHeadingProps = {
  /** Small label above the title (e.g. a section/context name). Any inline content, not just plain text. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /**
   * The literal HTML `title` attribute placed on the `<h1>` itself —
   * distinct from the `title` prop above, which is the *rendered* (possibly
   * clamped) content. Callers that clamp long on-screen text (session
   * titles, project names) pass the full, uncapped string here so the
   * complete value stays reachable on hover without a second competing
   * element.
   */
  titleAttr?: string;
  description?: ReactNode;
  /** Actions/controls anchored to the top-right (a button, a count, ...). */
  right?: ReactNode;
  className?: string;
};

/**
 * Every screen's header: eyebrow + h1 + description + right-slot
 * (design.md §2's reuse contract — one component, every route). L4: composes
 * only from plain markup, no data fetching of its own.
 */
export function PageHeading({
  eyebrow,
  title,
  titleAttr,
  description,
  right,
  className,
}: PageHeadingProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow ? (
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-xl font-semibold text-foreground" title={titleAttr}>
          {title}
        </h1>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {right ? <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}
