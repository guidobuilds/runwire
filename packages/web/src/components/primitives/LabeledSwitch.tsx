import { cn } from '../../lib/utils';
import { Switch } from '../ui/switch';

export type LabeledSwitchProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * L2 wrapper composing the CLI-vendored `ui/switch` (Base UI's
 * `Switch.Root`) with a visible text label (design.md §2/§7; "Toggle -> shadcn
 * switch" per the f2 dispatch). `onCheckedChange` matches Base UI's own
 * callback name and signature (`(checked, eventDetails) => void`); the
 * `eventDetails` argument is simply not read, so the old
 * `(checked: boolean) => void` callers pass through unchanged.
 *
 * Deliberately NOT a native `<label>` wrapping the switch, unlike the M4
 * hand-rolled `ui/Toggle.tsx` (`<label><button role="switch">…</button>
 * <span>{label}</span></label>`) -- verified empirically (disposable probes,
 * not assumed) that reusing that exact shape with Base UI's `Switch.Root`
 * breaks in two different ways at once:
 *
 * 1. Naming: `Switch.Root` auto-detects a wrapping `<label>` ancestor and
 *    points its own `aria-labelledby` at it (Base UI's documented "fallback
 *    for `<span>` controls labelled by wrapping/sibling native `<label>`",
 *    `internals/labelable-provider/useAriaLabelledBy.js`). That fallback
 *    does not defer to an explicit `aria-label` on the switch -- it still
 *    flattens the label's content, which includes the switch's own
 *    `aria-label` text, so the computed accessible name became
 *    `"Inclusive Inclusive"` (checked with `dom-accessibility-api`'s
 *    `computeAccessibleName`) instead of `"Inclusive"`, failing an exact
 *    `getByRole('switch', { name: 'Inclusive' })` query.
 * 2. Double-activation: clicking the switch's `<span role="switch">` (not
 *    itself a native form control) both runs Base UI's own click handler,
 *    which manually redispatches a `click` on the switch's hidden `<input>`
 *    (`dispatchClickWithModifiers`, to carry modifier-key state), AND -
 *    because that span sits inside a real `<label>` - triggers the browser's
 *    native "label click forwards to its associated control" behavior a
 *    *second* time on the same hidden input. Two click events toggle a
 *    checkbox twice, canceling out: `fireEvent.click` on the switch measured
 *    `checked` unchanged (traced with capture-phase `click`/`change`
 *    listeners: two `click` + two `change` events fired on the hidden input
 *    per one user click). This is specific to a non-native (`nativeButton:
 *    false`) Base UI control nested inside a real `<label>`; the M4
 *    `Toggle`'s own `<button role="switch">` never had this problem because
 *    its whole toggle logic *was* the label-forwarded click, not a second,
 *    separately-dispatched one.
 *
 * Both are avoided by not using a real `<label>` element at all: a plain
 * `<span>` wrapper does not trigger Base UI's `<label>`-ancestor fallback
 * (so the explicit `aria-label` on `Switch` is the sole source of the
 * accessible name), and does not trigger the browser's label/control click
 * forwarding (so `Switch`'s own internal click handling is the only thing
 * that fires). The visible text is a plain `<button>` (unstyled, `p-0
 * bg-transparent`), not a click handler on a bare `<span>` -- a non-interactive
 * element with a click handler fails `lint/a11y/useKeyWithClickEvents` for
 * good reason (no keyboard activation), and a real button gets Enter/Space
 * activation for free. Toggling from the button calls `onCheckedChange`
 * directly rather than routing through label-for-control forwarding, and is
 * safe from a double-toggle because the button and the switch are siblings,
 * not ancestor/descendant, so a click on one never bubbles through the other.
 */
export function LabeledSwitch({
  label,
  checked,
  onCheckedChange,
  disabled,
  className,
}: LabeledSwitchProps) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <Switch
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next)}
        disabled={disabled}
        aria-label={label}
      />
      <button
        type="button"
        className={cn(
          'bg-transparent p-0 text-inherit',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        )}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
      >
        {label}
      </button>
    </span>
  );
}
