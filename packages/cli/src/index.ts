import { parseArgs } from 'node:util';
import { adapters } from './adapters';
import { runDiscover } from './commands/discover';
import { runImport } from './commands/import';

const USAGE = `Usage:
  scout import [--adapter <id>] [--home <dir>] [--db <path>] [--no-titles]
  scout discover --adapter <id> [--home <dir>] [--json] [--no-titles]

Known adapters: ${adapters.map((a) => a.id).join(', ')}`;

async function main(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (subcommand === 'import') {
    let values: { adapter?: string; home?: string; db?: string; titles: boolean };
    try {
      const parsed = parseArgs({
        args: rest,
        options: {
          adapter: { type: 'string' },
          home: { type: 'string' },
          db: { type: 'string' },
          'no-titles': { type: 'boolean', default: false },
        },
        strict: true,
        allowPositionals: false,
      });
      values = {
        adapter: parsed.values.adapter,
        home: parsed.values.home,
        db: parsed.values.db,
        titles: !parsed.values['no-titles'],
      };
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      console.error(USAGE);
      return 2;
    }
    return runImport({
      adapters,
      adapterId: values.adapter,
      home: values.home,
      db: values.db,
      titles: values.titles,
    });
  }

  if (subcommand === 'discover') {
    let values: { adapter?: string; home?: string; json: boolean; titles: boolean };
    try {
      const parsed = parseArgs({
        args: rest,
        options: {
          adapter: { type: 'string' },
          home: { type: 'string' },
          json: { type: 'boolean', default: false },
          'no-titles': { type: 'boolean', default: false },
        },
        strict: true,
        allowPositionals: false,
      });
      values = {
        adapter: parsed.values.adapter,
        home: parsed.values.home,
        json: parsed.values.json ?? false,
        titles: !parsed.values['no-titles'],
      };
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      console.error(USAGE);
      return 2;
    }
    return runDiscover({
      adapters,
      adapterId: values.adapter,
      home: values.home,
      json: values.json,
      titles: values.titles,
    });
  }

  console.error(
    subcommand === undefined
      ? 'error: no subcommand given'
      : `error: unknown subcommand "${subcommand}"`,
  );
  console.error(USAGE);
  return 2;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
