import { ChevronsUpDownIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import { buttonVariants } from '../ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import type { FilterOption } from './filters';

export type FilterComboboxProps = {
  id: string;
  label: string;
  /** Plural noun used in the "All <noun>" empty state and the "<n> <noun>" summary. */
  noun: string;
  choices: FilterOption[];
  selected: string[];
  onSelect: (values: string[]) => void;
};

/**
 * Text-only sibling of `HarnessFilterCombobox`: the same Popover + Command
 * multi-select, minus the harness logos, for the Project and Model filters.
 * Those two used to be native `<select multiple>` listboxes, which rendered as
 * a permanently-open 3-row list that broke the toolbar's baseline alignment
 * (sessions-filter-dropdowns). Same collapsed single-line trigger, same
 * click-toggles-in-place semantics (the popover stays open across a
 * selection), same `filters.<dimension>` `string[]` state and `matchesList`
 * behavior -- only the control changed, not the filter shape.
 *
 * `CommandInput` is added here (and not on the harness one) because Project
 * can carry dozens of values; it is the same cmdk search already used by
 * `CommandPalette`, and `CommandList` supplies the scroll bound.
 */
export function FilterCombobox({
  id,
  label,
  noun,
  choices,
  selected,
  onSelect,
}: FilterComboboxProps) {
  const [open, setOpen] = useState(false);

  function toggle(value: string) {
    onSelect(
      selected.includes(value)
        ? selected.filter((current) => current !== value)
        : [...selected, value],
    );
  }

  const labelFor = (value: string) =>
    choices.find((choice) => choice.value === value)?.label ?? value;

  return (
    <div className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300">
      <span aria-hidden="true">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          aria-label={label}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'min-w-32 max-w-56 justify-between font-normal',
          )}
        >
          {selected.length === 0 ? (
            <span className="text-muted-foreground">All {noun}</span>
          ) : (
            <span className="truncate">
              {selected.length === 1 ? labelFor(selected[0] ?? '') : `${selected.length} ${noun}`}
            </span>
          )}
          <ChevronsUpDownIcon aria-hidden="true" className="opacity-50" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <Command>
            <CommandInput placeholder={`Search ${noun}…`} />
            <CommandList>
              <CommandEmpty>No {noun}.</CommandEmpty>
              <CommandGroup>
                {choices.map((choice) => (
                  <CommandItem
                    key={choice.value}
                    value={choice.label}
                    data-checked={selected.includes(choice.value)}
                    onSelect={() => {
                      toggle(choice.value);
                    }}
                  >
                    <span className="truncate">{choice.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
