
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// serve static client
app.use(express.static(path.join(__dirname, '..', 'client')));

// ensure sessions dir
const sessionsDir = path.join(__dirname, '..', 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir);

// WebSocket server
const wss = new WebSocket.Server({ server });

// helper structures
// rooms: roomName -> Set(ws)
const rooms = new Map();
// roomStrokes: roomName -> [stroke,...]
const roomStrokes = new Map();
// presence / cursors and users are kept global for convenience
const cursors = new Map();   // userId -> { x,y,color,ts }
const users = new Map();     // userId -> { name, color }

// fallback default room
const DEFAULT_ROOM = 'default';

// small palette helper
function getRandomColor() {
  const palette = [
    '#ef4444','#f97316','#f59e0b','#eab308','#84cc16',
    '#10b981','#06b6d4','#0ea5e9','#3b82f6','#6366f1',
    '#8b5cf6','#ec4899'
  ];
  return palette[Math.floor(Math.random() * palette.length)];
}

// Broadcast helpers
function broadcastAll(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(str);
  });
}

function broadcastExcept(sender, data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client !== sender && client.readyState === WebSocket.OPEN) client.send(str);
  });
}

function broadcastRoom(room, data, excludeWs = null) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  const set = rooms.get(room);
  if (!set) return;
  set.forEach((c) => {
    if (c.readyState === WebSocket.OPEN && c !== excludeWs) c.send(str);
  });
}

// Ensure a room exists
function ensureRoom(room) {
  if (!room) room = DEFAULT_ROOM;
  if (!rooms.has(room)) rooms.set(room, new Set());
  if (!roomStrokes.has(room)) roomStrokes.set(room, []);
  return room;
}

// connection handler
wss.on('connection', (ws) => {
  // assign ids & default color
  const userId = uuidv4();
  const color = getRandomColor();

  // basic per-connection metadata
  ws._id = userId;
  ws._room = DEFAULT_ROOM; // default room until client joins other
  ensureRoom(DEFAULT_ROOM);

  // register user (name may be set by client later)
  users.set(userId, { name: null, color });

  // add connection to default room set
  rooms.get(DEFAULT_ROOM).add(ws);

  // send initial snapshot for default room
  const initialStrokes = roomStrokes.get(DEFAULT_ROOM) || [];
  const knownUsers = Array.from(users.entries()).map(([id, info]) => ({ userId: id, name: info.name, color: info.color }));

  ws.send(JSON.stringify({
    type: 'init',
    userId,
    color,
    room: DEFAULT_ROOM,
    strokes: initialStrokes,
    users: knownUsers
  }));

  // announce presence to peers in the room
  broadcastRoom(DEFAULT_ROOM, { type: 'user-joined', userId, name: null, color }, ws);

  // message handler
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    // handle join-room quickly (special-case)
    if (msg.type === 'join-room') {
      const room = String(msg.room || DEFAULT_ROOM);
      // leave old room
      if (ws._room && rooms.has(ws._room)) {
        rooms.get(ws._room).delete(ws);
      }

      // join new room
      ws._room = room;
      ensureRoom(room);
      rooms.get(room).add(ws);

      // load persisted session if exists
      const sessionFile = path.join(sessionsDir, `${room}.json`);
      let saved = { strokes: [], meta: {} };
      if (fs.existsSync(sessionFile)) {
        try { saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8')); } catch (e) { saved = { strokes: [], meta: {} }; }
      } else {
        // if no persisted, ensure in-memory strokes map exists
        if (!roomStrokes.has(room)) roomStrokes.set(room, []);
      }

      // send init-room snapshot
      ws.send(JSON.stringify({ type: 'init-room', room, strokes: saved.strokes || roomStrokes.get(room) || [], meta: saved.meta || {} }));
      return;
    }

    // route messages scoped to current room
    const room = ws._room || DEFAULT_ROOM;
    ensureRoom(room);

    switch (msg.type) {
      case 'stroke': {
        // store stroke in room strokes and broadcast to peers in same room
        const s = msg.stroke;
        if (!s) break;
        // ensure roomStrokes exists
        const arr = roomStrokes.get(room);
        arr.push(s);
        broadcastRoom(room, { type: 'stroke', stroke: s }, ws);
        break;
      }

      case 'cursor': {
        // update presence and broadcast to same room
        cursors.set(msg.userId, { x: msg.x, y: msg.y, color: msg.color, ts: Date.now() });
        broadcastRoom(room, { type: 'cursor', userId: msg.userId, x: msg.x, y: msg.y, color: msg.color }, ws);
        break;
      }

      case 'clear': {
        // clear strokes for this room
        const arr = roomStrokes.get(room) || [];
        arr.length = 0;
        broadcastRoom(room, { type: 'clear' }, ws);
        break;
      }

      case 'undo': {
        // remove last stroke by user in this room
        const arr = roomStrokes.get(room) || [];
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i].userId === msg.userId) {
            const removed = arr.splice(i, 1)[0];
            broadcastRoom(room, { type: 'undo', userId: msg.userId, removedId: removed.id }, ws);
            break;
          }
        }
        break;
      }

      case 'set-name': {
        // update user entry (global) and broadcast to room
        const name = String(msg.name || '').slice(0, 40).trim();
        const existing = users.get(msg.userId) || {};
        const userColor = existing.color || getRandomColor();
        users.set(msg.userId, { name: name || null, color: userColor });
        broadcastRoom(room, { type: 'user-joined', userId: msg.userId, name: name || null, color: userColor });
        break;
      }

      case 'reaction': {
        // broadcast reactions to the same room
        broadcastRoom(room, { type: 'reaction', userId: msg.userId, emoji: msg.emoji, x: msg.x, y: msg.y }, ws);
        break;
      }

      case 'component-add': {
        // rebroadcast component into same room
        broadcastRoom(room, { type: 'component-added', component: msg.component }, ws);
        break;
      }

      case 'follow': {
        // follow/presenter messages (room-scoped)
        broadcastRoom(room, { type: 'follow', userId: msg.userId, viewport: msg.viewport }, ws);
        break;
      }

      case 'save-session': {
        // persist room strokes to a file
        if (msg.room) {
          const filepath = path.join(sessionsDir, `${msg.room}.json`);
          try {
            fs.writeFileSync(filepath, JSON.stringify({ strokes: msg.strokes || roomStrokes.get(msg.room) || [], meta: msg.meta || {} }, null, 2), 'utf8');
            ws.send(JSON.stringify({ type: 'save-ack', ok: true, room: msg.room }));
          } catch (e) {
            ws.send(JSON.stringify({ type: 'save-ack', ok: false, error: e.message }));
          }
        }
        break;
      }

      case 'load-session': {
        if (msg.room) {
          const filepath = path.join(sessionsDir, `${msg.room}.json`);
          let loaded = { strokes: [], meta: {} };
          try {
            if (fs.existsSync(filepath)) loaded = JSON.parse(fs.readFileSync(filepath, 'utf8'));
          } catch (e) { loaded = { strokes: [], meta: {} }; }
          // update in-memory room strokes as well
          roomStrokes.set(msg.room, loaded.strokes || []);
          ws.send(JSON.stringify({ type: 'load-ack', room: msg.room, strokes: loaded.strokes || [], meta: loaded.meta || {} }));
        }
        break;
      }

      // ping/pong support (simple echo)
      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
        break;
      }

      default: {
        // unknown: rebroadcast within room (safe fallback)
        broadcastRoom(room, msg, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    // cleanup: remove from room and notify peers
    if (ws._room && rooms.has(ws._room)) rooms.get(ws._room).delete(ws);
    users.delete(userId);
    cursors.delete(userId);
    // notify others in the room that this user left
    broadcastRoom(ws._room || DEFAULT_ROOM, { type: 'user-left', userId }, ws);
  });
});

// start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server listening on http://localhost:${PORT}`);
});
