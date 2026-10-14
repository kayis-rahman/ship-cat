import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Create a read-only JSONL tailer. Each emitted item identifies its home and the
 * byte offset of the source line, so identical IDs in different homes do not collide.
 * `read()` drains all currently available complete lines and retains partial lines.
 */
export function createLedgerReader(sources, { chunkSize = 64 * 1024 } = {}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new TypeError("sources must be a non-empty array");
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new RangeError("chunkSize must be positive");

  const files = sources.map((source) => {
    const path = resolve(typeof source === "string" ? source : source.path);
    const home = typeof source === "string" ? path : String(source.home ?? path);
    return { path, home, offset: 0, identity: null, mtimeMs: null, checkpoint: Buffer.alloc(0), pending: Buffer.alloc(0), lineOffset: 0 };
  });

  return {
    async read() {
      const output = [];
      for (const file of files) {
        let info;
        try {
          info = await stat(file.path);
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        const identity = `${info.dev}:${info.ino}`;
        if ((file.identity !== null && file.identity !== identity) || info.size < file.offset || (info.size === file.offset && file.mtimeMs !== null && info.mtimeMs !== file.mtimeMs)) {
          file.offset = 0;
          file.checkpoint = Buffer.alloc(0);
          file.pending = Buffer.alloc(0);
          file.lineOffset = 0;
        }
        if (file.offset > 0 && file.checkpoint.length) {
          const checkAt = file.offset - file.checkpoint.length;
          const handle = await open(file.path, "r");
          let current;
          try {
            current = Buffer.alloc(file.checkpoint.length);
            const { bytesRead } = await handle.read(current, 0, current.length, checkAt);
            current = current.subarray(0, bytesRead);
          } finally {
            await handle.close();
          }
          if (!current.equals(file.checkpoint)) {
            file.offset = 0;
            file.checkpoint = Buffer.alloc(0);
            file.pending = Buffer.alloc(0);
            file.lineOffset = 0;
          }
        }
        file.identity = identity;
        file.mtimeMs = info.mtimeMs;

        while (file.offset < info.size) {
          const length = Math.min(chunkSize, info.size - file.offset);
          const handle = await open(file.path, "r");
          let chunk;
          try {
            chunk = Buffer.alloc(length);
            const { bytesRead } = await handle.read(chunk, 0, length, file.offset);
            chunk = chunk.subarray(0, bytesRead);
          } finally {
            await handle.close();
          }
          if (!chunk.length) break;
          const chunkStart = file.offset;
          file.checkpoint = Buffer.concat([file.checkpoint, chunk]).subarray(-Math.max(1, 64));
          file.offset += chunk.length;
          const data = file.pending.length ? Buffer.concat([file.pending, chunk]) : chunk;
          let cursor = 0;
          for (let i = 0; i < data.length; i++) {
            if (data[i] !== 0x0a) continue;
            let line = data.subarray(cursor, i);
            if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
            const start = file.pending.length ? file.lineOffset : chunkStart + cursor;
            if (line.length) output.push(parseLine(file, line, start));
            cursor = i + 1;
          }
          file.pending = Buffer.from(data.subarray(cursor));
          file.lineOffset = file.pending.length ? file.offset - file.pending.length : file.offset;
        }
      }
      return output;
    },
    /** Current byte offsets, useful for diagnostics and restart planning. */
    offsets() {
      return files.map(({ home, path, offset }) => ({ home, path, offset }));
    },
  };
}

function parseLine(file, bytes, offset) {
  const line = bytes.toString("utf8");
  try {
    const record = JSON.parse(line);
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return { home: file.home, path: file.path, offset, line, record: null, error: "JSONL record must be an object" };
    }
    return { home: file.home, path: file.path, offset, line, record };
  } catch {
    return { home: file.home, path: file.path, offset, line, record: null, error: "Malformed JSONL record" };
  }
}
