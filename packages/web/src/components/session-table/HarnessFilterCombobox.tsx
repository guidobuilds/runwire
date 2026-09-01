import { ChevronsUpDownIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import { HarnessLogo } from '../primitives/HarnessLogo';
import { HarnessLogoStack } from '../primitives/HarnessLogoStack';
import { buttonVariants } from '../ui/button';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '../ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import type { FilterOption } from './filters';

export type HarnessFilterComboboxProps = {
  id: string;
  label: string;
  choices: FilterOption[];
  selected: string[];
  onSelect: (values: string[]) => void;
  displayNameFor?: (harnessId: string) => string;
};

/**
 * Icon+name multi-select replacement for the harness `MultiSelect`
 * (datatable-filters-revamp). Built on the already-installed `Popover` +
 * `Command` primitives (no `select.tsx`/`combobox.tsx` in this registry) --
 * clicking a row toggles it in place rather than closing the popover, which
 * is what makes this a real multi-select rather than cmdk's default
 * single-`onSelect`-then-close behavior. Bound to the same `filters.harness`
 * `string[]` state and `matchesList` semantics as before; only the control
 * changed, not the filter shape.
 */
export function HarnessFilterCombobox({
  id,
  label,
  choices,
  selected,
  onSelect,
  displayNameFor,
}: HarnessFilterComboboxProps) {
  const [open, setOpen] = useState(false);

  function toggle(value: string) {
    onSelect(
      selected.includes(value)
        ? selected.filter((current) => current !== value)
        : [...selected, value],
    );
  }

  const nameFor = (harnessId: string) => displayNameFor?.(harnessId) ?? harnessId;

  return (
    <div className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300">
      <span aria-hidden="true">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          aria-label={label}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'min-w-32 justify-between font-normal',
          )}
        >
          {selected.length === 0 ? (
            <span className="text-muted-foreground">All harnesses</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <HarnessLogoStack
                harnessIds={selected}
                displayNameFor={displayNameFor}
                size="xs"
                max={3}
              />
              <span>
                {selected.length === 1
                  ? nameFor(selected[0] ?? '')
                  : `${selected.length} harnesses`}
              </span>
            </span>
          )}
          <ChevronsUpDownIcon aria-hidden="true" className="opacity-50" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <Command>
            <CommandList>
              <CommandEmpty>No harnesses.</CommandEmpty>
              <CommandGroup>
                {choices.map((choice) => {
                  const isSelected = selected.includes(choice.value);
                  const name = nameFor(choice.value);
                  return (
                    <CommandItem
                      key={choice.value}
                      value={name}
                      data-checked={isSelected}
                      onSelect={() => {
                        toggle(choice.value);
                      }}
                    >
                      <HarnessLogo harnessId={choice.value} displayName={name} size="xs" />
                      <span>{name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
