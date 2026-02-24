// Usage tracker — reads stats-cache.json + tracks live session tokens.
const fs = require('fs');
const path = require('path');
const os = require('os');

const STATS_PATH = path.join(os.homedir(), '.claude', 'stats-cache.json');
const POLL_INTERVAL = 60000; // re-read stats file every 60s

class UsageTracker {
  constructor() {
    this._timer = null;
    this._onChange = null;

    // Live session tracking (tokens seen since app started)
    this.liveOutput = 0;
    this.liveInput = 0;
    this.liveCacheRead = 0;
    this.liveMessages = 0;

    // From stats-cache.json
    this.stats = null;
  }

  start(onChange) {
    this._onChange = onChange;
    this._readStats();
    this._timer = setInterval(() => this._readStats(), POLL_INTERVAL);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  // Called from tailer callback for each JSONL entry
  trackEntry(entry) {
    const usage = this._extractUsage(entry);
    if (usage) {
      this.liveOutput += usage.output_tokens || 0;
      this.liveInput += usage.input_tokens || 0;
      this.liveCacheRead += usage.cache_read_input_tokens || 0;
      this.liveMessages++;
      this._notify();
    }
  }

  _extractUsage(entry) {
    // Usage can be in several places depending on entry type
    // 1. progress entries with assistant message
    if (entry.type === 'progress' && entry.data && entry.data.message) {
      const msg = entry.data.message.message || entry.data.message;
      if (msg && msg.usage) return msg.usage;
    }
    // 2. assistant entries
    if (entry.type === 'assistant' && entry.message && entry.message.usage) {
      return entry.message.usage;
    }
    // 3. result entries
    if (entry.type === 'result' && entry.result && entry.result.usage) {
      return entry.result.usage;
    }
    return null;
  }

  _readStats() {
    try {
      if (!fs.existsSync(STATS_PATH)) return;
      const raw = fs.readFileSync(STATS_PATH, 'utf8');
      this.stats = JSON.parse(raw);
      this._notify();
    } catch (err) {
      // Silently ignore — file might be locked by Claude Code
    }
  }

  _notify() {
    if (this._onChange) this._onChange(this.getRendererState());
  }

  getRendererState() {
    const today = new Date().toISOString().slice(0, 10);

    // Today's stats from cache
    let todayTokens = 0;
    let todayMessages = 0;
    if (this.stats) {
      const dayTokens = (this.stats.dailyModelTokens || []).find(d => d.date === today);
      if (dayTokens && dayTokens.tokensByModel) {
        todayTokens = Object.values(dayTokens.tokensByModel).reduce((a, b) => a + b, 0);
      }
      const dayActivity = (this.stats.dailyActivity || []).find(d => d.date === today);
      if (dayActivity) {
        todayMessages = dayActivity.messageCount || 0;
      }
    }

    // Total all-time from cache
    let totalOutput = 0;
    let totalInput = 0;
    let totalCacheRead = 0;
    let totalSessions = 0;
    let totalMessages = 0;
    if (this.stats) {
      totalSessions = this.stats.totalSessions || 0;
      totalMessages = this.stats.totalMessages || 0;
      for (const model of Object.values(this.stats.modelUsage || {})) {
        totalOutput += model.outputTokens || 0;
        totalInput += model.inputTokens || 0;
        totalCacheRead += model.cacheReadInputTokens || 0;
      }
    }

    return {
      // Live (this app session)
      liveOutput: this.liveOutput,
      liveInput: this.liveInput,
      liveCacheRead: this.liveCacheRead,
      liveMessages: this.liveMessages,
      // Today (from stats-cache + live)
      todayTokens: todayTokens + this.liveOutput,
      todayMessages: todayMessages + this.liveMessages,
      // All-time
      totalOutput: totalOutput + this.liveOutput,
      totalInput: totalInput + this.liveInput,
      totalCacheRead: totalCacheRead + this.liveCacheRead,
      totalSessions,
      totalMessages: totalMessages + this.liveMessages,
    };
  }
}

module.exports = UsageTracker;
