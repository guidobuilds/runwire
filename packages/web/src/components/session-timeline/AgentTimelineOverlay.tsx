import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { SessionTimeline } from './SessionTimeline';

export type AgentTimelineOverlayProps = {
  agentId: string | null;
  onClose: () => void;
};

/**
 * "Quick view"'s Dialog target (timeline-chart-usability design.md §5,
 * f2-t5): a thin wrapper around `ui/dialog.tsx` rendering a full, unmodified
 * `SessionTimeline` scoped to one agent's own sessionId. Design.md §0:
 * `useSessionTimelineData(sessionId)` is fully self-contained for any
 * sessionId, including a subagent's own -- `<SessionTimeline id={agentId} />`
 * is a legitimate, zero-new-data-plumbing reuse of the exact same code path
 * the page's own top-level timeline already uses, not a hypothetical.
 *
 * `open`/`onOpenChange` are controlled entirely by this component's own
 * props (`agentId !== null` -> open), matching `AgentTrack`'s controlled-
 * `Popover` shape for "Quick view"/"Go to session" -- the caller (`AgentTrack`)
 * owns `quickViewAgentId` as local state and mounts exactly one of these for
 * the whole track, not one per lane.
 */
export function AgentTimelineOverlay({ agentId, onClose }: AgentTimelineOverlayProps) {
  return (
    <Dialog
      open={agentId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/*
        `sm:max-w-5xl`, not bare `max-w-5xl` (f2-t8 bug fix): `ui/dialog.tsx`'s
        `DialogContent` base classes already carry `sm:max-w-sm`. `cn()`'s
        `twMerge` only dedupes classes sharing the exact same variant/modifier
        group, so an unprefixed `max-w-5xl` passed in here does NOT replace
        that `sm:`-scoped default -- both classes survive onto the element,
        and Tailwind v4 emits all `sm:`-prefixed utilities inside a `@media`
        block placed *after* the unprefixed utilities in the generated
        stylesheet. With equal specificity (single class each), source order
        wins: `sm:max-w-sm` (24rem) beat `max-w-5xl` (64rem) on every viewport
        >=640px, capping this dialog at ~384px instead of ~1024px. Overriding
        with the same `sm:` prefix puts the two classes in the same twMerge
        group so `sm:max-w-5xl` correctly wins, while the base's unprefixed
        `max-w-[calc(100%-2rem)]` still governs narrow/mobile widths.
      */}
      <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agent timeline</DialogTitle>
        </DialogHeader>
        {agentId !== null ? <SessionTimeline id={agentId} /> : null}
      </DialogContent>
    </Dialog>
  );
}
