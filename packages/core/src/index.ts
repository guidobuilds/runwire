// M0 placeholders, kept so packages/server and packages/web (M3/M4) do not
// need to change yet. Superseded by the real exports below (docs/PLAN.md M1).
export const VERSION = '0.0.0' as const;
export type Placeholder = { readonly scout: true };

export * from './adapter';
export * from './events';
export * from './link';
export * from './model';
export * from './project';
export * from './reduce';
export * from './scan';
export * from './trace';
