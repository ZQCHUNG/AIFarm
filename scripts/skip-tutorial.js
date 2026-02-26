// skip-tutorial.js — Force-complete tutorial and persist it
const WebSocket = require('ws');
const http = require('http');

const expr = `(function(){
  // Force complete tutorial
  TutorialManager.init({completed: true});
  // Persist it so farm-update won't overwrite
  if (window.buddy && window.buddy.saveTutorial) {
    window.buddy.saveTutorial({completed: true});
  }
  return 'Tutorial force-completed and saved. active=' + TutorialManager.isActive() + ' complete=' + TutorialManager.isComplete();
})()`;

http.get('http://localhost:9222/json', res => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => {
    const wsUrl = JSON.parse(d)[0].webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    });
    ws.on('message', raw => {
      const r = JSON.parse(raw);
      if (r.id === 1) {
        console.log(r.result.result ? r.result.result.value : JSON.stringify(r.result));
        ws.close(); process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 5000);
  });
});
