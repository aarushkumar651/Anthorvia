/**
 * VOICE WEBSOCKET SERVER SETUP
 * 
 * Attaches a WebSocket server to the existing Express HTTP server.
 * No separate port needed — uses same port as REST API.
 * 
 * Connection URL for mobile app:
 * wss://anthorvia.up.railway.app/voice?token=<jwt>
 * 
 * To activate: call initVoiceWebSocket(httpServer) in src/server.js
 */

const { WebSocketServer } = require('ws');
const { handleVoiceConnection } = require('./voiceHandler');
const voiceConfig = require('../config/voiceConfig');
const logger = require('../../config/logger');

let wss = null;

/**
 * Initialize Voice WebSocket server on existing HTTP server.
 * 
 * HOW TO ACTIVATE in src/server.js:
 * 
 * const { initVoiceWebSocket } = require('./voice/websocket');
 * 
 * const server = app.listen(config.port, ...);
 * initVoiceWebSocket(server); // Add this line
 * 
 * @param {http.Server} httpServer - Express HTTP server instance
 */
function initVoiceWebSocket(httpServer) {
  wss = new WebSocketServer({
    server: httpServer,
    path: voiceConfig.websocket.path,        // '/voice'
    maxPayload: voiceConfig.websocket.maxPayloadMB * 1024 * 1024,
  });

  wss.on('connection', (ws, request) => {
    handleVoiceConnection(ws, request);
  });

  wss.on('error', (err) => {
    logger.error('Voice WebSocket Server error', { error: err.message });
  });

  // Ping all clients periodically to detect stale connections
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, voiceConfig.websocket.pingInterval);

  wss.on('close', () => clearInterval(pingInterval));

  logger.info('Voice WebSocket server initialized', {
    path: voiceConfig.websocket.path,
    url: `wss://anthorvia.up.railway.app${voiceConfig.websocket.path}`,
  });

  return wss;
}

function getWSSInstance() {
  return wss;
}

module.exports = { initVoiceWebSocket, getWSSInstance };
