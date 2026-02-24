/**
 * Parses raw JSONL entries into standardized activity events for the state machine.
 *
 * Output event shape:
 * { type: 'tool_use'|'thinking'|'text'|'bash_progress'|'mcp_progress'|'user',
 *   tool?: string, detail?: string, timestamp: number }
 */

class EventParser {
  /**
   * Parse a single JSONL entry → array of 0+ activity events.
   */
  static parse(entry) {
    const events = [];
    const ts = Date.now();

    // Progress events (bash_progress, mcp_progress)
    if (entry.type === 'progress' && entry.data) {
      if (entry.data.type === 'bash_progress') {
        events.push({ type: 'bash_progress', detail: '$ running...', timestamp: ts });
      } else if (entry.data.type === 'mcp_progress') {
        events.push({
          type: 'mcp_progress',
          tool: entry.data.toolName || '',
          detail: entry.data.status || '',
          timestamp: ts,
        });
      }
      return events;
    }

    // Assistant messages
    if (entry.type === 'assistant' && entry.message && entry.message.content) {
      const contents = Array.isArray(entry.message.content)
        ? entry.message.content
        : [entry.message.content];

      for (const block of contents) {
        if (block.type === 'tool_use') {
          const detail = EventParser._toolDetail(block.name, block.input);
          events.push({ type: 'tool_use', tool: block.name, detail, timestamp: ts });
        } else if (block.type === 'thinking') {
          events.push({ type: 'thinking', timestamp: ts });
        } else if (block.type === 'text' && block.text) {
          const snippet = block.text.slice(0, 60).replace(/\n/g, ' ');
          events.push({ type: 'text', detail: snippet, timestamp: ts });
        }
      }
      return events;
    }

    // User messages (including tool results)
    if (entry.type === 'user') {
      events.push({ type: 'user', timestamp: ts });
      return events;
    }

    // Result entries — indicates assistant turn is complete (waiting for user)
    if (entry.type === 'result') {
      events.push({ type: 'user', timestamp: ts });
      return events;
    }

    return events;
  }

  /**
   * Extract a human-readable detail string from tool name + input.
   */
  static _toolDetail(name, input) {
    if (!input) return name;

    switch (name) {
      case 'Read':
        return EventParser._shortenPath(input.file_path);
      case 'Write':
        return 'Writing ' + EventParser._shortenPath(input.file_path);
      case 'Edit':
        return 'Editing ' + EventParser._shortenPath(input.file_path);
      case 'Glob':
        return input.pattern || 'Glob';
      case 'Grep':
        return 'Search: ' + (input.pattern || '').slice(0, 30);
      case 'Bash':
        return '$ ' + (input.command || '').slice(0, 40);
      case 'Task':
        return input.description || 'Sub-agent';
      case 'WebFetch':
        return input.url ? EventParser._shortenUrl(input.url) : 'Fetching...';
      case 'WebSearch':
        return 'Search: ' + (input.query || '').slice(0, 30);
      default:
        // For MCP tools, show a cleaned-up name
        if (name.includes('browser') || name.includes('playwright')) {
          const short = name.split('__').pop() || name;
          return short.replace('browser_', '');
        }
        return name;
    }
  }

  static _shortenPath(p) {
    if (!p) return '';
    const parts = p.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return parts.join('/');
    return '.../' + parts.slice(-2).join('/');
  }

  static _shortenUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname + u.pathname.slice(0, 20);
    } catch {
      return url.slice(0, 30);
    }
  }
}

module.exports = EventParser;
