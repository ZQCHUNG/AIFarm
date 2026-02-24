// State machine — now a class so we can have one per buddy.
class StateMachine {
  static IDLE_TIMEOUT = 8000;
  static SLEEP_TIMEOUT = 60000;

  static TOOL_MAP = {
    Write: 'writing', Edit: 'writing', NotebookEdit: 'writing',
    Read: 'reading', Glob: 'reading', Grep: 'reading',
    Bash: 'bash', Task: 'tasking',
    WebFetch: 'browsing', WebSearch: 'browsing',
  };

  constructor() {
    this.state = 'idle';
    this.detail = '';
    this._idleTimer = null;
    this._sleepTimer = null;
    this._resetTimers();
  }

  _setState(s, d) {
    this.state = s;
    this.detail = d || '';
    this._resetTimers();
  }

  _resetTimers() {
    clearTimeout(this._idleTimer);
    clearTimeout(this._sleepTimer);
    if (this.state !== 'idle' && this.state !== 'sleeping') {
      this._idleTimer = setTimeout(() => {
        this.state = 'idle'; this.detail = '';
        this._sleepTimer = setTimeout(() => {
          this.state = 'sleeping'; this.detail = '';
        }, StateMachine.SLEEP_TIMEOUT);
      }, StateMachine.IDLE_TIMEOUT);
    } else if (this.state === 'idle') {
      this._sleepTimer = setTimeout(() => {
        this.state = 'sleeping'; this.detail = '';
      }, StateMachine.SLEEP_TIMEOUT);
    }
  }

  transition(event) {
    if (!event) return;
    switch (event.type) {
      case 'tool_use': {
        const t = event.tool || '';
        if (StateMachine.TOOL_MAP[t]) this._setState(StateMachine.TOOL_MAP[t], event.detail);
        else if (t.includes('browser') || t.includes('playwright')) this._setState('browsing', event.detail);
        else this._setState('writing', event.detail);
        break;
      }
      case 'thinking': this._setState('thinking', ''); break;
      case 'text': this._setState('thinking', event.detail); break;
      case 'bash_progress': this._setState('bash', event.detail); break;
      case 'mcp_progress':
        this._setState(event.tool && event.tool.includes('browser') ? 'browsing' : 'bash', event.detail);
        break;
      case 'user': this._setState('idle', ''); break;
    }
  }
}
