import path from 'node:path';
import { ok, err } from '../types/result.js';

/**
 * PathJail ensures all file operations strictly remain inside the designated workspace root,
 * preventing directory traversal (e.g. `../../etc/passwd` or `..\..\Windows`).
 */
export class PathJail {
  constructor(workspaceRoot) {
    this.canonicalRoot = path.resolve(workspaceRoot);
  }

  resolveSafe(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
      return err({
        code: 'INVALID_PATH',
        path: String(targetPath),
        message: 'Target path must be a non-empty string.',
      });
    }

    // Resolve relative to workspace root
    const resolved = path.resolve(this.canonicalRoot, targetPath);

    // Verify whether resolved path is inside canonical root
    const relative = path.relative(this.canonicalRoot, resolved);
    const isEscaping = relative.startsWith('..') || path.isAbsolute(relative);

    if (isEscaping) {
      return err({
        code: 'PATH_ESCAPE',
        path: targetPath,
        message: `Security violation: Path '${targetPath}' resolves to '${resolved}', which escapes the workspace jail '${this.canonicalRoot}'.`,
      });
    }

    return ok(resolved);
  }

  getRoot() {
    return this.canonicalRoot;
  }
}
