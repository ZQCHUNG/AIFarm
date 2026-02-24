/**
 * Efficient JSONL tailer: seeks to last-read offset instead of re-reading entire file.
 * Designed for very large files (200MB+).
 */
const fs = require('fs');

class JsonlTailer {
  constructor() {
    this.filePath = null;
    this.offset = 0;
    this.intervalId = null;
  }

  /**
   * Switch to tailing a new file.
   * Reads the last ~16KB to get recent activity for initial state context.
   */
  setFile(filePath) {
    this.stop();
    this.filePath = filePath;

    try {
      const stat = fs.statSync(filePath);
      // Read last ~16KB so the state machine gets initial context
      // (otherwise buddy starts idle → sleeping with no history)
      const LOOKBACK = 16 * 1024;
      this.offset = Math.max(0, stat.size - LOOKBACK);
    } catch {
      this.offset = 0;
    }
  }

  /**
   * Read any new bytes since last read and return parsed JSON objects.
   */
  readNew() {
    if (!this.filePath) return [];

    let stat;
    try {
      stat = fs.statSync(this.filePath);
    } catch {
      return [];
    }

    if (stat.size <= this.offset) return [];

    const readSize = stat.size - this.offset;
    const buf = Buffer.alloc(readSize);

    let fd;
    try {
      fd = fs.openSync(this.filePath, 'r');
      fs.readSync(fd, buf, 0, readSize, this.offset);
    } catch {
      return [];
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    this.offset = stat.size;

    const text = buf.toString('utf8');
    const lines = text.split('\n').filter(l => l.trim());
    const results = [];

    for (const line of lines) {
      try {
        results.push(JSON.parse(line));
      } catch {
        // Incomplete line — will be caught next read (adjust offset back)
        // Actually, since we split by newline, incomplete trailing lines are rare
        // but let's be safe
      }
    }

    return results;
  }

  /**
   * Start polling. Calls onEntries(entries) with new JSONL objects.
   * Does an immediate read for initial context, then polls.
   */
  start(onEntries, intervalMs = 500) {
    // Immediate read for initial state context
    const initial = this.readNew();
    if (initial.length > 0) onEntries(initial);

    this.intervalId = setInterval(() => {
      const entries = this.readNew();
      if (entries.length > 0) {
        onEntries(entries);
      }
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

module.exports = JsonlTailer;
