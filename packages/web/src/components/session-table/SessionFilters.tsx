import { Button } from '../ui/button';
import { FilterCombobox } from './FilterCombobox';
import type {
  DatePreset,
  FilterOptionSets,
  SessionFilters as SessionFilterState,
  SubagentsFilter,
} from './filters';
import { emptyFilters } from './filters';
import { HarnessFilterCombobox } from './HarnessFilterCombobox';

export type SessionFiltersProps = {
  scope: 'project' | 'harness' | 'all';
  filters: SessionFilterState;
  options: FilterOptionSets;
  /** Resolves a harness id to its adapter display name for the combobox (design-approved D-LOGO-1-safe: only used as visible list-item/trigger text, not a `HarnessLogo` `title`). */
  displayNameFor?: (harnessId: string) => string;
  onChange: (next: SessionFilterState) => void;
  matched: number;
  total: number;
};

const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
];

const SUBAGENT_CHOICES: Array<{ value: SubagentsFilter; label: string }> = [
  { value: 'any', label: 'Any' },
  { value: 'with', label: 'With subagents' },
  { value: 'without', label: 'Without subagents' },
];

/**
 * Shared surface for every native form control left in this toolbar (the date
 * preset/custom-range controls, Subagents, Search -- Harness/Project/Model are
 * Popover comboboxes).
 * Uses the same design tokens `ui/input.tsx` builds on (`border-input`,
 * `focus-visible:ring-ring/50`, `dark:bg-input/30`) rather than literal
 * zinc-* colors, so these read as proper shadcn-styled selectors/inputs and
 * pick up a visible focus ring, instead of the flat bare-HTML look they had
 * before (datatable-filters-revamp).
 */
const CONTROL =
  'rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

/**
 * Toolbar above the session view: the option lists come from the rows actually
 * present (`distinctOptions`), so no choice here can ever return nothing.
 */
export function SessionFilters({
  scope,
  filters,
  options,
  displayNameFor,
  onChange,
  matched,
  total,
}: SessionFiltersProps) {
  const patch = (next: Partial<SessionFilterState>) => {
    onChange({ ...filters, ...next });
  };

  return (
    <div className="flex shrink-0 flex-wrap items-end gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      {/*
       * Each dimension gets a selector unless it's already the fixed scope
       * (nothing to narrow there). 'all' (the unscoped landing, f5) has
       * neither dimension fixed, so both selectors show — design.md §5.
       */}
      {scope !== 'harness' ? (
        <HarnessFilterCombobox
          id="session-filter-harness"
          label="Harness"
          choices={options.harness}
          selected={filters.harness}
          displayNameFor={displayNameFor}
          onSelect={(harness) => {
            patch({ harness });
          }}
        />
      ) : null}

      {scope !== 'project' ? (
        <FilterCombobox
          id="session-filter-project"
          label="Project"
          noun="projects"
          choices={options.project}
          selected={filters.project}
          onSelect={(project) => {
            patch({ project });
          }}
        />
      ) : null}

      <FilterCombobox
        id="session-filter-model"
        label="Model"
        noun="models"
        choices={options.model}
        selected={filters.model}
        onSelect={(model) => {
          patch({ model });
        }}
      />

      <label
        className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300"
        htmlFor="session-filter-date"
      >
        Started
        <select
          id="session-filter-date"
          className={CONTROL}
          value={filters.date.preset}
          onChange={(event) => {
            patch({ date: { ...filters.date, preset: event.target.value as DatePreset } });
          }}
        >
          {DATE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      {filters.date.preset === 'custom' ? (
        <>
          <label
            className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300"
            htmlFor="session-filter-from"
          >
            From
            <input
              id="session-filter-from"
              type="date"
              className={CONTROL}
              value={filters.date.from ?? ''}
              onChange={(event) => {
                patch({ date: { ...filters.date, from: event.target.value } });
              }}
            />
          </label>
          <label
            className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300"
            htmlFor="session-filter-to"
          >
            To
            <input
              id="session-filter-to"
              type="date"
              className={CONTROL}
              value={filters.date.to ?? ''}
              onChange={(event) => {
                patch({ date: { ...filters.date, to: event.target.value } });
              }}
            />
          </label>
        </>
      ) : null}

      <label
        className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300"
        htmlFor="session-filter-subagents"
      >
        Subagents
        <select
          id="session-filter-subagents"
          className={CONTROL}
          value={filters.subagents}
          onChange={(event) => {
            patch({ subagents: event.target.value as SubagentsFilter });
          }}
        >
          {SUBAGENT_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>

      <label
        className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300"
        htmlFor="session-filter-search"
      >
        Search
        <input
          id="session-filter-search"
          type="search"
          placeholder="title or id"
          className={CONTROL}
          value={filters.search}
          onChange={(event) => {
            patch({ search: event.target.value });
          }}
        />
      </label>

      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          onChange(emptyFilters());
        }}
      >
        Clear filters
      </Button>

      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {matched === total ? `${total} sessions` : `${matched} of ${total} sessions`}
      </span>
    </div>
  );
}
