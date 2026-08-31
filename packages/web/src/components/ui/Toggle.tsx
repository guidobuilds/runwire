export type ToggleProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

export function Toggle({ label, checked, onCheckedChange, disabled, className }: ToggleProps) {
  const track = [
    'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
    checked ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-600',
    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
  ].join(' ');
  const thumb = [
    'inline-block h-4 w-4 rounded-full bg-white dark:bg-zinc-900 transition-transform',
    checked ? 'translate-x-4' : 'translate-x-0.5',
  ].join(' ');

  return (
    <label
      className={[
        'inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={track}
        onClick={() => {
          if (!disabled) onCheckedChange(!checked);
        }}
      >
        <span className={thumb} />
      </button>
      <span>{label}</span>
    </label>
  );
}
