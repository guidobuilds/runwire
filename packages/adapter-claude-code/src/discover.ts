import { join } from 'node:path/posix';
import type { AdapterContext, Diagnostic, Known, SessionBundle } from '@runwire/core';
import { makeDiagnostic } from '@runwire/core';
import type { ComputeLink } from './compute';
import { computeBundle } from './compute';
import {
  agentIdFromFile,
  agentMetaFilePath,
  cwdFromProjectDirname,
  isAgentFile,
  isIgnoredEntry,
  isRootSessionFile,
  projectsRoot,
  sessionIdFromRootFile,
} from './paths';
import { resolveProject } from './project';
import { readRecords } from './records';
import { parseMetaJson } from './schema';

const HARNESS_ID = 'claude-code';

function enumeratedDirVanished(path: string): Error {
  return new Error(`enumerated directory vanished before its listing: ${path}`);
}

export async function probe(
  ctx: AdapterContext,
): Promise<{ installed: boolean; roots: string[]; notes: string[] }> {
  const root = projectsRoot(ctx);
  const stat = await ctx.fs.stat(root);
  if (!stat?.isDirectory) {
    return { installed: false, roots: [], notes: [`${root} not found`] };
  }
  return { installed: true, roots: [root], notes: [] };
}

type Stat = { sizeBytes: number; mtimeMs: number };

function unchanged(known: Known, path: string, stat: Stat): boolean {
  const k = known.get(path);
  return k !== undefined && k.size === stat.sizeBytes && k.mtime === stat.mtimeMs;
}

async function listAgentFiles(ctx: AdapterContext, subagentsDir: string): Promise<string[]> {
  const entries = await ctx.fs.readdir(subagentsDir);
  return entries.filter(isAgentFile).sort();
}

function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const oneLine = raw.replace(/\s*\n\s*/g, ' ').trim();
  return oneLine.length > 180 ? `${oneLine.slice(0, 177)}...` : oneLine;
}

type SourceBundleInput = {
  sessionId: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  isRoot: boolean;
  link: ComputeLink;
  fallbackCwd?: string;
};

async function computeSourceBundle(
  ctx: AdapterContext,
  input: SourceBundleInput,
): Promise<SessionBundle> {
  try {
    const { records: recordStream, result } = readRecords(ctx, input.path);
    const parsed: Array<{
      record: Parameters<typeof computeBundle>[0]['records'][number]['record'];
      line: number;
    }> = [];
    for await (const r of recordStream) parsed.push(r);
    const { diagnostics: recordDiagnostics } = result();

    return await computeBundle({
      harnessId: HARNESS_ID,
      sessionId: input.sessionId,
      isRoot: input.isRoot,
      source: { path: input.path, sizeBytes: input.sizeBytes, mtimeMs: input.mtimeMs },
      link: input.link,
      records: parsed,
      recordDiagnostics,
      resolveProject: (cwd) => resolveProject({ cwd }, { fs: ctx.fs }),
      fallbackCwd: input.fallbackCwd,
      ctx,
    });
  } catch (err) {
    const diagnostic: Diagnostic = makeDiagnostic(
      'error',
      'source-read-failed',
      sanitizeErrorMessage(err),
    );
    return {
      project: { key: input.sessionId, name: input.sessionId, identity: 'cwd' },
      session: {
        id: input.sessionId,
        harnessId: HARNESS_ID,
        projectKey: input.sessionId,
        parentId: input.link.parentId,
        relation: input.link.relation,
        depth: input.link.depth,
        agentType: input.link.agentType,
        spawnCallId: input.link.spawnCallId,
        sourcePath: input.path,
        sourceSize: input.sizeBytes,
        sourceMtime: input.mtimeMs,
      },
      steps: [],
      diagnostics: [diagnostic],
    };
  }
}

type ChildFile = { agentFile: string; path: string; stat: Stat };

async function statChildren(
  ctx: AdapterContext,
  subagentsDir: string,
  agentFiles: readonly string[],
): Promise<ChildFile[]> {
  const out: ChildFile[] = [];
  for (const agentFile of agentFiles) {
    const path = join(subagentsDir, agentFile);
    const stat = await ctx.fs.stat(path);
    if (!stat) continue;
    out.push({ agentFile, path, stat });
  }
  return out;
}

async function computeChildBundle(
  ctx: AdapterContext,
  opts: {
    projectDir: string;
    rootSessionId: string;
    agentId: string;
    path: string;
    stat: Stat;
    fallbackCwd?: string;
  },
): Promise<SessionBundle> {
  const metaPath = agentMetaFilePath(opts.projectDir, opts.rootSessionId, opts.agentId);
  const parentId = `${HARNESS_ID}:${opts.rootSessionId}`;
  let link: ComputeLink = { parentId, relation: 'subagent', depth: 1 };
  let metaDiagnostic: Diagnostic | undefined;

  const metaRaw = await ctx.fs.readFile(metaPath);
  if (metaRaw === undefined) {
    metaDiagnostic = makeDiagnostic(
      'warn',
      'missing-agent-meta',
      'A child source has no matching .meta.json file',
    );
  } else {
    try {
      const meta = parseMetaJson(JSON.parse(metaRaw));
      if (meta) {
        link = {
          parentId,
          relation: 'subagent',
          agentType: meta.agentType,
          depth: meta.spawnDepth ?? 1,
          spawnCallId: meta.toolUseId,
        };
      } else {
        metaDiagnostic = makeDiagnostic(
          'warn',
          'invalid-agent-meta',
          'Could not parse the subagent .meta.json file',
        );
      }
    } catch {
      metaDiagnostic = makeDiagnostic(
        'warn',
        'invalid-agent-meta',
        'Could not parse the subagent .meta.json file',
      );
    }
  }

  const bundle = await computeSourceBundle(ctx, {
    sessionId: `${HARNESS_ID}:${opts.rootSessionId}/${opts.agentId}`,
    path: opts.path,
    sizeBytes: opts.stat.sizeBytes,
    mtimeMs: opts.stat.mtimeMs,
    isRoot: false,
    link,
    fallbackCwd: opts.fallbackCwd,
  });
  if (metaDiagnostic) bundle.diagnostics.push(metaDiagnostic);
  return bundle;
}

export async function* discover(ctx: AdapterContext, known: Known): AsyncIterable<SessionBundle> {
  const root = projectsRoot(ctx);
  const projectDirNames = [...(await ctx.fs.readdir(root))].sort();

  for (const projectDirName of projectDirNames) {
    const projectDir = join(root, projectDirName);
    const projectStat = await ctx.fs.stat(projectDir);
    if (projectStat === undefined) throw enumeratedDirVanished(projectDir);
    if (!projectStat.isDirectory) continue;

    const entries = [...(await ctx.fs.readdir(projectDir))].sort();
    const rootSessionIds = new Set(entries.filter(isRootSessionFile).map(sessionIdFromRootFile));
    const fallbackCwd = cwdFromProjectDirname(projectDirName);

    for (const entry of entries) {
      if (isRootSessionFile(entry)) {
        const sessionId = sessionIdFromRootFile(entry);
        const rootPath = join(projectDir, entry);
        const rootStat = await ctx.fs.stat(rootPath);
        if (!rootStat) continue;

        const subagentsDir = join(projectDir, sessionId, 'subagents');
        const agentFiles = await listAgentFiles(ctx, subagentsDir);
        const children = await statChildren(ctx, subagentsDir, agentFiles);

        const rootUnchanged = unchanged(known, rootPath, rootStat);
        const allChildrenUnchanged = children.every((c) => unchanged(known, c.path, c.stat));
        if (rootUnchanged && allChildrenUnchanged) continue;

        yield await computeSourceBundle(ctx, {
          sessionId: `${HARNESS_ID}:${sessionId}`,
          path: rootPath,
          sizeBytes: rootStat.sizeBytes,
          mtimeMs: rootStat.mtimeMs,
          isRoot: true,
          link: { depth: 0 },
          fallbackCwd,
        });

        for (const child of children) {
          yield await computeChildBundle(ctx, {
            projectDir,
            rootSessionId: sessionId,
            agentId: agentIdFromFile(child.agentFile),
            path: child.path,
            stat: child.stat,
            fallbackCwd,
          });
        }
        continue;
      }

      if (isIgnoredEntry(entry)) continue;
      if (rootSessionIds.has(entry)) continue;

      const sessionDir = join(projectDir, entry);
      const sessionDirStat = await ctx.fs.stat(sessionDir);
      if (sessionDirStat === undefined) throw enumeratedDirVanished(sessionDir);
      if (!sessionDirStat.isDirectory) continue;

      const sessionId = entry;
      const subagentsDir = join(sessionDir, 'subagents');
      const agentFiles = await listAgentFiles(ctx, subagentsDir);
      if (agentFiles.length === 0) continue;
      const children = await statChildren(ctx, subagentsDir, agentFiles);

      if (children.every((c) => unchanged(known, c.path, c.stat))) continue;

      for (const child of children) {
        yield await computeChildBundle(ctx, {
          projectDir,
          rootSessionId: sessionId,
          agentId: agentIdFromFile(child.agentFile),
          path: child.path,
          stat: child.stat,
          fallbackCwd,
        });
      }
    }
  }

  const rootStat = await ctx.fs.stat(root);
  if (!rootStat?.isDirectory) throw enumeratedDirVanished(root);
}
