import { parseArgs } from 'node:util';
import { adapters } from './adapters';
import { runDiscover } from './commands/discover';
import { runImport } from './commands/import';
import { assertBindHost, runServe } from './commands/serve';
import { streamOutput } from './output';

const USAGE = `Usage:
  runwire import [--adapter <id>] [--home <dir>] [--db <path>] [--no-titles] [--force]
  runwire discover --adapter <id> [--home <dir>] [--json] [--no-titles]
  runwire serve [--db <path>] [--host <host>] [--port <n>] [--no-titles] [--expose]

Known adapters: ${adapters.map((a) => a.id).join(', ')}

Runwire is early beta: flags, output and the database schema may change.`;

async function main(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (subcommand === 'import') {
    let values: { adapter?: string; home?: string; db?: string; titles: boolean; force: boolean };
    try {
      const parsed = parseArgs({
        args: rest,
        options: {
          adapter: { type: 'string' },
          home: { type: 'string' },
          db: { type: 'string' },
          'no-titles': { type: 'boolean', default: false },
          force: { type: 'boolean', default: false },
        },
        strict: true,
        allowPositionals: false,
      });
      values = {
        adapter: parsed.values.adapter,
        home: parsed.values.home,
        db: parsed.values.db,
        titles: !parsed.values['no-titles'],
        force: parsed.values.force ?? false,
      };
    } catch (e) {
      await streamOutput.err(`error: ${e instanceof Error ? e.message : String(e)}`);
      await streamOutput.err(USAGE);
      return 2;
    }
    return runImport({
      adapters,
      output: streamOutput,
      adapterId: values.adapter,
      home: values.home,
      db: values.db,
      titles: values.titles,
      force: values.force,
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
      await streamOutput.err(`error: ${e instanceof Error ? e.message : String(e)}`);
      await streamOutput.err(USAGE);
      return 2;
    }
    return runDiscover({
      adapters,
      output: streamOutput,
      adapterId: values.adapter,
      home: values.home,
      json: values.json,
      titles: values.titles,
    });
  }

  if (subcommand === 'serve') {
    let values: { db?: string; host?: string; port?: string; titles: boolean; expose: boolean };
    try {
      const parsed = parseArgs({
        args: rest,
        options: {
          db: { type: 'string' },
          host: { type: 'string' },
          port: { type: 'string' },
          'no-titles': { type: 'boolean', default: false },
          expose: { type: 'boolean', default: false },
        },
        strict: true,
        allowPositionals: false,
      });
      values = {
        db: parsed.values.db,
        host: parsed.values.host,
        port: parsed.values.port,
        titles: !parsed.values['no-titles'],
        expose: parsed.values.expose ?? false,
      };
      if (values.port !== undefined) {
        const n = Number(values.port);
        if (!Number.isInteger(n) || n < 0 || n > 65535) {
          await streamOutput.err('error: --port must be an integer between 0 and 65535');
          await streamOutput.err(USAGE);
          return 2;
        }
      }
      if (values.host !== undefined) {
        const hostError = assertBindHost(values.host);
        if (hostError !== undefined && (values.host.trim() === '' || !values.expose)) {
          await streamOutput.err(hostError);
          await streamOutput.err(USAGE);
          return 2;
        }
      }
    } catch (e) {
      await streamOutput.err(`error: ${e instanceof Error ? e.message : String(e)}`);
      await streamOutput.err(USAGE);
      return 2;
    }
    return runServe({ ...values, output: streamOutput });
  }

  await streamOutput.err(
    subcommand === undefined
      ? 'error: no subcommand given'
      : `error: unknown subcommand "${subcommand}"`,
  );
  await streamOutput.err(USAGE);
  return 2;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    async (e) => {
      await streamOutput.err(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
