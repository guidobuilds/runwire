import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SessionSummary } from '../api/types';
import { shortId } from '../lib/format';
import { isMachineInitiated } from '../lib/initiator';
import { usePrefs } from '../state/prefs';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command';
import { Kbd } from './ui/kbd';

type CachedSession = {
  id: string;
  label: string;
  projectName?: string;
};

/**
 * Structural read of one cached query's `data`, not a full parse -- this is a
 * best-effort UI index over whatever shapes `api/queries.ts` happens to
 * produce (`{ summaries }` for project/harness/compare sessions, `{ summary }`
 * for a single session), not a contract any of those hooks promise to keep.
 */
function extractSummaries(data: unknown): SessionSummary[] {
  if (!data || typeof data !== 'object') return [];
  const out: SessionSummary[] = [];
  if ('summaries' in data && Array.isArray((data as { summaries: unknown }).summaries)) {
    out.push(...(data as { summaries: SessionSummary[] }).summaries);
  }
  if ('summary' in data && (data as { summary?: unknown }).summary) {
    out.push((data as { summary: SessionSummary }).summary);
  }
  return out;
}

/**
 * Every `SessionSummary` already sitting in the query cache, deduped by id.
 * f5 (sessions-landing) has not shipped `useAllSessions()` yet, so there is no
 * single query to read: this walks whatever project/harness/compare/single-
 * session queries a user has already visited (design.md §5's "search over
 * loaded sessions" -- explicitly no new endpoint for this palette).
 *
 * With `showAutomated` off the list queries already come back filtered, but the
 * cache is not uniformly filtered: `sessions/:id` (Session detail, reachable by
 * deep link or Back) and `sessions?ids=` (Compare) both resolve machine-started
 * sessions on purpose, so they leak into this walk. Filtering here is the
 * consistent choice -- the approved model is that a hidden session counts
 * nowhere, and a palette that offered 318 SDK runs the tables refuse to list
 * would reintroduce exactly the noise the preference removes.
 *
 * `hidden` is returned rather than dropped silently: the escape hatch (turn the
 * preference on) is only useful if the user can tell there is something behind
 * it. This is the palette's one deviation from "just search what's loaded", and
 * it is a deviation towards saying more, not less.
 */
function collectCachedSessions(
  queryClient: QueryClient,
  showAutomated: boolean,
): { sessions: CachedSession[]; hidden: number } {
  const byId = new Map<string, CachedSession>();
  const hiddenIds = new Set<string>();
  for (const query of queryClient.getQueryCache().getAll()) {
    for (const summary of extractSummaries(query.state.data)) {
      if (!showAutomated && isMachineInitiated(summary)) {
        hiddenIds.add(summary.id);
        continue;
      }
      const title = summary.title?.value.trim();
      byId.set(summary.id, {
        id: summary.id,
        label: title && title !== '' ? title : shortId(summary.id),
        projectName: summary.project?.name,
      });
    }
  }
  return {
    sessions: [...byId.values()].sort((a, b) => a.label.localeCompare(b.label)),
    hidden: hiddenIds.size,
  };
}

/**
 * The shell's ⌘K search: a topbar trigger button plus a `command`+`dialog`
 * palette (design.md §5) that searches client-side over whatever sessions are
 * already loaded and navigates to the selected session on select. Focus
 * trapping is Base UI `Dialog.Root`'s own default `modal` behavior (verified
 * against `@base-ui/react/dialog`'s `DialogRootProps`, not assumed).
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<CachedSession[]>([]);
  const [hiddenAutomated, setHiddenAutomated] = useState(0);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showAutomated } = usePrefs();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Recomputed on open rather than kept live: the cache changes as a side
  // effect of navigation the palette itself causes (closing it), and a
  // snapshot taken at open time is what the user was actually searching.
  useEffect(() => {
    if (!open) return;
    const { sessions: found, hidden } = collectCachedSessions(queryClient, showAutomated);
    setSessions(found);
    setHiddenAutomated(hidden);
  }, [open, queryClient, showAutomated]);

  function selectSession(id: string) {
    setOpen(false);
    void navigate({ to: '/sessions/$id', params: { id } });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <SearchIcon className="size-3.5" aria-hidden="true" />
        Search
        <Kbd className="ml-1">⌘K</Kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search sessions"
        description="Jump to a loaded session"
      >
        {/*
         * `CommandDialog` (base-nova's shadcn `command.tsx`) only wraps
         * `children` in `Dialog`/`DialogContent` -- unlike the classic shadcn
         * recipe, it does NOT also wrap them in cmdk's own `<Command>` root.
         * Every other `Command*` part reads cmdk's store via a React context
         * that only `<Command>` provides; omitting it here threw
         * "Cannot read properties of undefined (reading 'subscribe')" from
         * inside cmdk itself (verified against the installed `cmdk@1.1.1`
         * source, not assumed) as soon as the dialog opened.
         */}
        <Command>
          <CommandInput placeholder="Search loaded sessions…" />
          <CommandList>
            <CommandEmpty>
              {sessions.length === 0
                ? 'No sessions loaded yet — open Projects or Harnesses first.'
                : 'No matches.'}
            </CommandEmpty>
            <CommandGroup heading="Sessions">
              {sessions.map((session) => (
                <CommandItem
                  key={session.id}
                  value={`${session.label} ${session.id} ${session.projectName ?? ''}`}
                  onSelect={() => selectSession(session.id)}
                >
                  <span className="flex flex-col">
                    <span>{session.label}</span>
                    {session.projectName ? (
                      <span className="text-xs text-muted-foreground">{session.projectName}</span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {hiddenAutomated > 0 ? (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              {hiddenAutomated} automated {hiddenAutomated === 1 ? 'session' : 'sessions'} not
              searched — turn on “Automated” to include them.
            </p>
          ) : null}
        </Command>
      </CommandDialog>
    </>
  );
}
