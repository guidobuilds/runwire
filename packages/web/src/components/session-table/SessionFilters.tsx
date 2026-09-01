import type { ChangeEvent } from 'react';
import { Badge } from '../primitives/Badge';
import { Button } from '../ui/button';
import type {
  DatePreset,
  FilterOption,
  FilterOptionSets,
  SessionFilters as SessionFilterState,
  SubagentsFilter,
} from './filters';
import { emptyFilters } from './filters';

export type SessionFiltersProps = {
  scope: 'project' | 'harness' | 'all';
  filters: SessionFilterState;
  options: FilterOptionSets;
  /** Mirrors the shell's global toggle; shown as a badge (design.md §6). */
  inclusive: boolean;
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

const CONTROL =
  'rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100';

function selectedValues(event: ChangeEvent<HTMLSelectElement>): string[] {
  return Array.from(event.target.selectedOptions, (option) => option.value);
}

function MultiSelect({
  id,
  label,
  choices,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  choices: FilterOption[];
  selected: string[];
  onSelect: (values: string[]) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300" htmlFor={id}>
      {label}
      <select
        id={id}
        multiple
        className={`${CONTROL} h-16 min-w-32`}
        value={selected}
        onChange={(event) => {
          onSelect(selectedValues(event));
        }}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Toolbar above the session view: the option lists come from the rows actually
 * present (`distinctOptions`), so no choice here can ever return nothing.
 */
export function SessionFilters({
  scope,
  filters,
  options,
  inclusive,
  onChange,
  matched,
  total,
}: SessionFiltersProps) {
  const patch = (next: Partial<SessionFilterState>) => {
    onChange({ ...filters, ...next });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <Badge tone={inclusive ? 'info' : 'neutral'}>{inclusive ? 'Inclusive' : 'Exclusive'}</Badge>

      {/*
       * Each dimension gets a selector unless it's already the fixed scope
       * (nothing to narrow there). 'all' (the unscoped landing, f5) has
       * neither dimension fixed, so both selectors show — design.md §5.
       */}
      {scope !== 'harness' ? (
        <MultiSelect
          id="session-filter-harness"
          label="Harness"
          choices={options.harness}
          selected={filters.harness}
          onSelect={(harness) => {
            patch({ harness });
          }}
        />
      ) : null}

      {scope !== 'project' ? (
        <MultiSelect
          id="session-filter-project"
          label="Project"
          choices={options.project}
          selected={filters.project}
          onSelect={(project) => {
            patch({ project });
          }}
        />
      ) : null}

      <MultiSelect
        id="session-filter-model"
        label="Model"
        choices={options.model}
        selected={filters.model}
        onSelect={(model) => {
          patch({ model });
        }}
      />

      <MultiSelect
        id="session-filter-mode"
        label="Mode"
        choices={options.mode}
        selected={filters.mode}
        onSelect={(mode) => {
          patch({ mode });
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
