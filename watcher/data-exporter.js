// Data Exporter — analyzes recent JSONL events and exports a "coding vibe" summary.
// Produces coding-vibe.json used by the farm's atmosphere system.
const fs = require('fs');
const path = require('path');
const writeFileAtomic = require('write-file-atomic');

const EXPORT_PATH = path.join(__dirname, '..', 'farm', 'coding-vibe.json');
const EXPORT_INTERVAL = 30000; // export every 30 seconds
const WINDOW_MS = 5 * 60 * 1000; // analyze last 5 minutes of events

class DataExporter {
  constructor() {
    this._timer = null;
    this._events = [];       // rolling window of recent events
    this._onChange = null;
    this.vibeState = null;   // last computed vibe state
  }

  // Record an event from the JSONL tailer
  recordEvent(evt) {
    this._events.push({
      type: evt.type,
      tool: evt.tool || null,
      detail: evt.detail || '',
      timestamp: Date.now(),
    });
  }

  // Record a bash error (detected from bash_progress or tool results)
  recordBashError() {
    this._events.push({
      type: 'bash_error',
      tool: 'Bash',
      detail: '',
      timestamp: Date.now(),
    });
  }

  start(onChange) {
    this._onChange = onChange;
    this._timer = setInterval(() => this._export(), EXPORT_INTERVAL);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  // Force an export (called on app quit)
  flush() {
    this._export();
  }

  _export() {
    // Prune old events outside the analysis window
    const cutoff = Date.now() - WINDOW_MS;
    this._events = this._events.filter(e => e.timestamp >= cutoff);

    const vibe = this._computeVibe();
    this.vibeState = vibe;

    try {
      writeFileAtomic.sync(EXPORT_PATH, JSON.stringify(vibe, null, 2), 'utf8');
    } catch (err) {
      console.error('[DataExporter] Write error:', err.message);
    }

    if (this._onChange) this._onChange(vibe);
  }

  _computeVibe() {
    const events = this._events;
    const now = Date.now();

    // Count event types
    let toolUseCount = 0;
    let thinkingCount = 0;
    let textCount = 0;
    let bashCount = 0;
    let bashErrorCount = 0;
    let userCount = 0;
    let mcpCount = 0;

    // Tool diversity
    const toolSet = new Set();

    // Dominant activity tracking
    const activityCounts = { writing: 0, reading: 0, bash: 0, thinking: 0, browsing: 0, tasking: 0 };

    for (const evt of events) {
      switch (evt.type) {
        case 'tool_use':
          toolUseCount++;
          if (evt.tool) {
            toolSet.add(evt.tool);
            // Map to activity category
            if (['Write', 'Edit', 'NotebookEdit'].includes(evt.tool)) activityCounts.writing++;
            else if (['Read', 'Glob', 'Grep'].includes(evt.tool)) activityCounts.reading++;
            else if (evt.tool === 'Bash') activityCounts.bash++;
            else if (evt.tool === 'Task') activityCounts.tasking++;
            else if (['WebFetch', 'WebSearch'].includes(evt.tool) || evt.tool.includes('browser')) activityCounts.browsing++;
          }
          break;
        case 'thinking': thinkingCount++; activityCounts.thinking++; break;
        case 'text': textCount++; break;
        case 'bash_progress': bashCount++; activityCounts.bash++; break;
        case 'bash_error': bashErrorCount++; break;
        case 'mcp_progress': mcpCount++; break;
        case 'user': userCount++; break;
      }
    }

    const totalEvents = events.length;

    // Activity intensity (events per minute over the window)
    const windowMinutes = WINDOW_MS / 60000;
    const eventsPerMinute = totalEvents / windowMinutes;

    // Error rate (bash errors / total bash events)
    const totalBash = bashCount + bashErrorCount;
    const errorRate = totalBash > 0 ? bashErrorCount / totalBash : 0;

    // Determine dominant activity
    let dominantActivity = 'idle';
    let maxCount = 0;
    for (const [activity, count] of Object.entries(activityCounts)) {
      if (count > maxCount) { maxCount = count; dominantActivity = activity; }
    }
    if (totalEvents === 0) dominantActivity = 'idle';

    // Determine mood
    const mood = this._computeMood(eventsPerMinute, errorRate, dominantActivity, toolUseCount, thinkingCount);

    // Vibe score: 0.0 (struggling) to 1.0 (flowing)
    const vibeScore = this._computeVibeScore(eventsPerMinute, errorRate, toolSet.size, toolUseCount, thinkingCount);

    return {
      timestamp: new Date().toISOString(),
      vibeScore: Math.round(vibeScore * 100) / 100,
      mood,
      metrics: {
        eventsPerMinute: Math.round(eventsPerMinute * 10) / 10,
        errorRate: Math.round(errorRate * 100) / 100,
        toolDiversity: toolSet.size,
        totalEvents,
        dominantActivity,
        toolUseCount,
        thinkingCount,
        textCount,
        bashCount,
        bashErrorCount,
      },
      // Simplified atmosphere hints for the renderer
      atmosphere: this._computeAtmosphere(vibeScore, mood, errorRate),
    };
  }

  _computeMood(epm, errorRate, dominant, toolUse, thinking) {
    // No activity → idle
    if (epm < 0.5) return 'idle';

    // Heavy errors → debugging
    if (errorRate > 0.4) return 'debugging';

    // Lots of thinking, little output → exploring
    if (thinking > toolUse * 2) return 'exploring';

    // Good tool use, low errors → productive
    if (toolUse > 3 && errorRate < 0.2) return 'productive';

    // Moderate activity → focused
    if (epm > 2) return 'focused';

    return 'working';
  }

  _computeVibeScore(epm, errorRate, toolDiversity, toolUse, thinking) {
    let score = 0.5; // baseline

    // Activity boost (more events = more energy = higher vibe, capped)
    score += Math.min(0.2, epm * 0.02);

    // Tool diversity boost (using many tools = versatile = good flow)
    score += Math.min(0.1, toolDiversity * 0.02);

    // Productivity boost (tool_use events are productive)
    score += Math.min(0.15, toolUse * 0.01);

    // Error penalty
    score -= errorRate * 0.3;

    // Thinking bonus (some thinking is good, too much might mean stuck)
    if (thinking > 0 && thinking <= toolUse) {
      score += 0.05; // healthy thinking-to-action ratio
    } else if (thinking > toolUse * 3) {
      score -= 0.1; // too much thinking, might be stuck
    }

    return Math.max(0, Math.min(1, score));
  }

  _computeAtmosphere(vibeScore, mood, errorRate) {
    // Map vibe to visual atmosphere parameters for the renderer
    if (vibeScore >= 0.75) {
      return {
        skyTint: 'warm',       // golden hour feel
        animalMood: 'happy',   // animals dance/play
        lampLit: false,
        groundTint: null,
      };
    } else if (vibeScore >= 0.5) {
      return {
        skyTint: 'neutral',
        animalMood: 'calm',
        lampLit: false,
        groundTint: null,
      };
    } else if (vibeScore >= 0.3) {
      return {
        skyTint: 'cool',       // slightly overcast
        animalMood: 'cautious',
        lampLit: true,         // station lamp on
        groundTint: null,
      };
    } else {
      return {
        skyTint: 'dark',       // storm brewing
        animalMood: 'huddled', // animals gather together
        lampLit: true,
        groundTint: 'grey',
      };
    }
  }

  // Get state for renderer
  getRendererState() {
    return this.vibeState;
  }
}

module.exports = DataExporter;
