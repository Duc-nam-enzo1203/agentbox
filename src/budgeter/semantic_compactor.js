export class SemanticCompactor {
  /**
   * Compacts raw tool results before insertion into agent conversation history.
   * Handles large JSON arrays, object dumps, and repeated text lines.
   */
  static compact(rawOutput, maxChars = 800) {
    if (typeof rawOutput !== 'string') {
      try {
        rawOutput = JSON.stringify(rawOutput);
      } catch {
        rawOutput = String(rawOutput);
      }
    }

    if (rawOutput.length <= maxChars) {
      return {
        compacted: rawOutput,
        originalChars: rawOutput.length,
        finalChars: rawOutput.length,
        ratio: 1.0,
      };
    }

    // Attempt 1: Detect and compact JSON array of objects
    try {
      const parsed = JSON.parse(rawOutput);
      if (Array.isArray(parsed) && parsed.length > 5) {
        const totalItems = parsed.length;
        const sample = parsed.slice(0, 3);
        const keys = parsed[0] && typeof parsed[0] === 'object' ? Object.keys(parsed[0]) : [];

        const summary = [
          `[AgentBox SemanticCompactor: Summary of ${totalItems} tabular items]`,
          keys.length > 0 ? `Fields: ${keys.join(', ')}` : '',
          `Sample (first 3 items):`,
          JSON.stringify(sample, null, 2),
          `... and ${totalItems - 3} additional items omitted for token efficiency.`,
        ].filter(Boolean).join('\n');

        return {
          compacted: summary,
          originalChars: rawOutput.length,
          finalChars: summary.length,
          ratio: (summary.length / rawOutput.length).toFixed(3),
        };
      }
    } catch {
      // Not JSON, continue with line-based compaction
    }

    // Attempt 2: Line-based compaction (truncate middle, preserve head & tail)
    const lines = rawOutput.split('\n');
    if (lines.length > 30) {
      const head = lines.slice(0, 15).join('\n');
      const tail = lines.slice(-10).join('\n');
      const omitted = lines.length - 25;
      const compacted = `${head}\n\n... [AgentBox: Omitted ${omitted} repetitive lines (${rawOutput.length - head.length - tail.length} chars)] ...\n\n${tail}`;

      return {
        compacted,
        originalChars: rawOutput.length,
        finalChars: compacted.length,
        ratio: (compacted.length / rawOutput.length).toFixed(3),
      };
    }

    // Fallback: character truncation
    const preview = rawOutput.slice(0, maxChars / 2);
    const tail = rawOutput.slice(-maxChars / 4);
    const compacted = `${preview}\n... [Truncated ${rawOutput.length - preview.length - tail.length} chars] ...\n${tail}`;

    return {
      compacted,
      originalChars: rawOutput.length,
      finalChars: compacted.length,
      ratio: (compacted.length / rawOutput.length).toFixed(3),
    };
  }

  /**
   * Generates unified diff between original and modified text
   */
  static generateDiffSummary(original, modified) {
    if (original === modified) return '(No changes)';

    const origLines = original.split('\n');
    const modLines = modified.split('\n');

    let added = 0;
    let removed = 0;

    const diffLines = [];
    const maxScan = Math.max(origLines.length, modLines.length);

    for (let i = 0; i < maxScan; i++) {
      const o = origLines[i];
      const m = modLines[i];

      if (o === undefined && m !== undefined) {
        diffLines.push(`+ ${m}`);
        added++;
      } else if (o !== undefined && m === undefined) {
        diffLines.push(`- ${o}`);
        removed++;
      } else if (o !== m) {
        diffLines.push(`- ${o}`);
        diffLines.push(`+ ${m}`);
        removed++;
        added++;
      }
    }

    return {
      summary: `+${added} lines, -${removed} lines`,
      diff: diffLines.slice(0, 20).join('\n') + (diffLines.length > 20 ? `\n... and ${diffLines.length - 20} more diff lines` : ''),
    };
  }
}
