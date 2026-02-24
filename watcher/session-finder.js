// Scans ~/.claude/projects/ for ALL recently active .jsonl session files.
const fs = require('fs');
const path = require('path');
const os = require('os');

class SessionFinder {
  constructor() {
    this.baseDir = path.join(os.homedir(), '.claude', 'projects');
    this.intervalId = null;
  }

  // Find all .jsonl files modified within the last `thresholdMs` milliseconds.
  // Returns array of { path, project, mtime }.
  findActiveSessions(thresholdMs = 30000) {
    const results = [];
    const now = Date.now();

    try {
      if (!fs.existsSync(this.baseDir)) return results;

      const projectDirs = fs.readdirSync(this.baseDir, { withFileTypes: true });
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;
        const projectPath = path.join(this.baseDir, dir.name);

        let entries;
        try {
          entries = fs.readdirSync(projectPath, { withFileTypes: true });
        } catch {
          continue;
        }

        // For each project dir, find the most recently modified .jsonl
        let best = null;
        let bestMtime = 0;

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
          const fullPath = path.join(projectPath, entry.name);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.mtimeMs > bestMtime) {
              bestMtime = stat.mtimeMs;
              best = fullPath;
            }
          } catch {
            continue;
          }
        }

        if (best && (now - bestMtime) < thresholdMs) {
          results.push({
            path: best,
            project: SessionFinder.prettifyProject(dir.name),
            mtime: bestMtime,
          });
        }
      }
    } catch {
      // base dir might not exist yet
    }

    // Sort by mtime descending (most recent first)
    results.sort((a, b) => b.mtime - a.mtime);
    return results;
  }

  // Convert folder name like "D--Mine-Stock" → "Stock"
  // "C--Users-joe.zhang16" → "~" (home dir)
  static prettifyProject(dirName) {
    // Reconstruct original path: "D--Mine-Stock" → ["D:", "Mine", "Stock"]
    const segments = dirName.replace(/^([A-Z])-/, '$1:').split('-').filter(Boolean);

    // Detect home directory pattern (dots become hyphens in folder name)
    const homeDirName = require('os').homedir().split(/[\\/]/).pop();
    const homeHyphen = homeDirName.replace(/\./g, '-');
    if (dirName.endsWith(homeHyphen) || dirName.includes('Users-' + homeHyphen)) {
      return '~';
    }

    // Take last 1-2 meaningful segments
    const skip = new Set(['C:', 'D:', 'E:', 'Users', 'user', 'home', 'Mine', 'projects', 'repos', 'src']);
    const meaningful = segments.filter(s => !skip.has(s));
    if (meaningful.length > 0) {
      return meaningful.slice(-2).join('/');
    }
    return lastSeg || dirName;
  }

  // Start polling. Calls onChange(activeSessions) with full list each cycle.
  start(onChange, intervalMs = 5000, thresholdMs = 30000) {
    const poll = () => {
      const sessions = this.findActiveSessions(thresholdMs);
      onChange(sessions);
    };

    this.intervalId = setInterval(poll, intervalMs);
    poll(); // immediate first check
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

module.exports = SessionFinder;
