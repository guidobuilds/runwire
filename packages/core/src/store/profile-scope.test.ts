import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { isProfileScopeMember, readProfileScopeNodes } from './profile-scope';
import { openStore } from './store';

function seed(db: Database): void {
  db.run(
    'INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
    ['test', 'Test', '1', '[]'],
  );
}

function session(db: Database, id: string, parentId: string | null = null): void {
  db.run(
    `INSERT INTO sessions (id, harness_id, parent_id, source_path, source_size, source_mtime)
     VALUES (?, 'test', ?, ?, 1, 1)`,
    [id, parentId, `source:${id}`],
  );
}

describe('profile scope', () => {
  test('tree includes the root and all descendants, ordered root first then binary id', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'z-child', 'root');
    session(db, 'A-child', 'root');
    session(db, 'grandchild', 'A-child');

    expect(readProfileScopeNodes(db, 'root', 'tree')?.map((node) => node.id)).toEqual([
      'root',
      'A-child',
      'grandchild',
      'z-child',
    ]);
    db.close();
  });

  test('a child tree starts at that child and excludes its ancestors and siblings', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'child', 'root');
    session(db, 'grand', 'child');
    session(db, 'sibling', 'root');

    expect(readProfileScopeNodes(db, 'child', 'tree')?.map((node) => node.id)).toEqual([
      'child',
      'grand',
    ]);
    expect(isProfileScopeMember(db, 'child', 'tree', 'root')).toBe(false);
    expect(isProfileScopeMember(db, 'child', 'tree', 'sibling')).toBe(false);
    db.close();
  });

  test('own includes only the requested session', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'child', 'root');

    expect(readProfileScopeNodes(db, 'root', 'own')?.map((node) => node.id)).toEqual(['root']);
    expect(isProfileScopeMember(db, 'root', 'own', 'child')).toBe(false);
    db.close();
  });

  test('tree traversal reaches a deep descendant without using stored depth', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'n0');
    for (let index = 1; index <= 128; index += 1) {
      session(db, `n${index}`, `n${index - 1}`);
    }

    const nodes = readProfileScopeNodes(db, 'n0', 'tree');
    expect(nodes).toHaveLength(129);
    expect(isProfileScopeMember(db, 'n0', 'tree', 'n128')).toBe(true);
    db.close();
  });

  test('UNION id closure terminates cycles and returns every reachable node once', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'a', 'b');
    session(db, 'b', 'a');
    session(db, 'leaf', 'b');

    expect(readProfileScopeNodes(db, 'a', 'tree')?.map((node) => node.id)).toEqual([
      'a',
      'b',
      'leaf',
    ]);
    db.close();
  });

  test('ids containing commas, slashes, and percent characters are opaque bound values', () => {
    const { db } = openStore(':memory:');
    seed(db);
    const root = 'root,/%25';
    const child = 'child,/%';
    session(db, root);
    session(db, child, root);

    expect(readProfileScopeNodes(db, root, 'tree')?.map((node) => node.id)).toEqual([root, child]);
    expect(isProfileScopeMember(db, root, 'tree', child)).toBe(true);
    db.close();
  });

  test('an absent session returns null and a non-member never passes membership', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'outside');

    expect(readProfileScopeNodes(db, 'missing', 'tree')).toBeNull();
    expect(isProfileScopeMember(db, 'missing', 'tree', 'root')).toBe(false);
    expect(isProfileScopeMember(db, 'root', 'tree', 'outside')).toBe(false);
    db.close();
  });
});
