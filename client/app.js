

(() => {
  // ----- DOM references (optional elements guarded) -----
  const canvas = document.getElementById('canvas');
  const usersList = document.getElementById('usersList');
  // note: original used 'cursor-layer' id in your snippet
  const cursorLayer = document.getElementById('cursor-layer') || document.getElementById('cursorLayer') || document.createElement('div');
  const colorEl = document.getElementById('color');
  const sizeEl = document.getElementById('size');
  const penBtn = document.getElementById('pen');
  const eraserBtn = document.getElementById('eraser');
  const undoBtn = document.getElementById('undo');
  const clearBtn = document.getElementById('clear');
  const nameInput = document.getElementById('nameInput');

  // Optional UI controls (rooms / save / load / rtt / fps / reactions)
  const roomInput = document.getElementById('roomInput');
  const joinRoomBtn = document.getElementById('joinRoomBtn');
  const saveSessionBtn = document.getElementById('saveSessionBtn');
  const loadSessionBtn = document.getElementById('loadSessionBtn');
  const rttBadge = document.getElementById('rttBadge');
  const fpsBadge = document.getElementById('fpsBadge');
  const reactionButtons = Array.from(document.querySelectorAll('.react') || []);

  // If cursor layer didn't exist initially, attach a new absolute layer to the canvas wrapper (best-effort)
  (function ensureCursorLayer() {
    if (!document.getElementById('cursor-layer') && cursorLayer && cursorLayer.parentElement === null && canvas) {
      cursorLayer.id = 'cursor-layer';
      cursorLayer.style.position = 'absolute';
      cursorLayer.style.left = '0';
      cursorLayer.style.top = '0';
      cursorLayer.style.right = '0';
      cursorLayer.style.bottom = '0';
      cursorLayer.style.pointerEvents = 'none';
      cursorLayer.style.zIndex = '999';
      const wrapper = canvas.parentElement || document.body;
      wrapper.style.position = wrapper.style.position || 'relative';
      wrapper.appendChild(cursorLayer);
    }
  })();

  // ----- Canvas context -----
  if (!canvas) {
    console.error('Canvas element (#canvas) not found. Aborting client script.');
    return;
  }
  const ctx = canvas.getContext('2d', { alpha: true });

  // ----- resize & DPR scaling -----
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawAll();
  }
  window.addEventListener('resize', () => setTimeout(resize, 50));
  setTimeout(resize, 60);

  // ----- state -----
  let myUserId = null;
  let myColor = (colorEl && colorEl.value) || '#0ea5e9';
  let strokes = [];
  let isDrawing = false;
  let currentStroke = null;
  let tool = 'pen';
  let clients = {}; // userId -> { el, color, name }
  let currentRoom = 'default';

  // ----- WebSocket connection -----
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}`);
  socket.addEventListener('open', () => {
    console.log('WS open', location.host);
    // auto-join default or roomInput value
    const requested = (roomInput && roomInput.value && roomInput.value.trim()) ? roomInput.value.trim() : currentRoom;
    joinRoom(requested);
  });

  socket.addEventListener('error', (e) => console.warn('WS error', e));
  socket.addEventListener('close', () => console.log('WS closed'));

  // ----- Helpers: drawing -----
  function drawStrokeImmediate(stroke) {
    if (!stroke || !stroke.points || stroke.points.length < 1) return;
    const { color, width, points } = stroke;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function clearCanvas() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
  }

  function redrawAll() {
    clearCanvas();
    for (const s of strokes) drawStrokeImmediate(s);
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const p = (e.touches && e.touches[0]) ? e.touches[0] : e;
    const x = (p.clientX) - rect.left;
    const y = (p.clientY) - rect.top;
    return { x, y };
  }

  // ----- pointer & drawing events -----
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    const p = getPos(e);
    currentStroke = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      userId: myUserId,
      color: tool === 'eraser' ? '#ffffff' : (colorEl ? colorEl.value : myColor),
      width: parseInt(sizeEl ? sizeEl.value : 3, 10) || 3,
      points: [p]
    };
  }, { passive: true });

  let sendThrottle = null;
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
    const y = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;

    // lightweight cursor broadcast (room-scoped server will forward only to same room)
    if (socket.readyState === WebSocket.OPEN && myUserId) {
      socket.send(JSON.stringify({ type: 'cursor', userId: myUserId, x, y, color: myColor }));
    }

    if (!isDrawing || !currentStroke) return;
    const p = getPos(e);
    currentStroke.points.push(p);

    // draw only the last segment for responsiveness
    const seg = { color: currentStroke.color, width: currentStroke.width, points: currentStroke.points.slice(-2) };
    drawStrokeImmediate(seg);

    // throttle sending strokes so we don't flood (server will broadcast)
    if (!sendThrottle) {
      sendThrottle = setTimeout(() => {
        sendThrottle = null;
      }, 80);
    }
  }, { passive: true });

  function finishStroke() {
    if (!isDrawing || !currentStroke) return;
    strokes.push(currentStroke);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'stroke', stroke: currentStroke }));
    }
    currentStroke = null;
    isDrawing = false;
    redrawAll();
  }

  canvas.addEventListener('pointerup', finishStroke);
  canvas.addEventListener('pointercancel', finishStroke);
  canvas.addEventListener('pointerout', finishStroke);

  // ----- UI actions (tools) -----
  if (penBtn) penBtn.addEventListener('click', () => { tool = 'pen'; penBtn.classList.add('active'); eraserBtn && eraserBtn.classList.remove('active'); });
  if (eraserBtn) eraserBtn.addEventListener('click', () => { tool = 'eraser'; eraserBtn.classList.add('active'); penBtn && penBtn.classList.remove('active'); });
  if (clearBtn) clearBtn.addEventListener('click', () => {
    strokes = [];
    clearCanvas();
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'clear' }));
  });
  if (undoBtn) undoBtn.addEventListener('click', () => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'undo', userId: myUserId }));
  });

  // ----- name input -----
  if (nameInput) {
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = nameInput.value.trim();
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'set-name', userId: myUserId, name: v }));
      }
    });
    nameInput.addEventListener('blur', () => {
      const v = nameInput.value.trim();
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'set-name', userId: myUserId, name: v }));
    });
  }

  // ----- users & cursors helpers -----
  function addUserToList(id, color, isMe=false, name=null) {
    if (!usersList) return;
    if (clients[id]) {
      if (name) {
        const nameEl = clients[id].el.querySelector('.user-name');
        if (nameEl) nameEl.textContent = name || (isMe ? 'You' : `User ${id.slice(0,6)}`);
      }
      if (color) clients[id].el.querySelector('.user-dot').style.background = color;
      clients[id].name = name || clients[id].name;
      return;
    }
    const li = document.createElement('li');
    li.className = 'user-item';
    li.id = `user-${id}`;
    const displayName = name ? name : (isMe ? 'You' : `User ${id.slice(0,6)}`);
    li.innerHTML = `<span class="user-dot" style="background:${color || '#888'}"></span><span class="user-name">${displayName}</span>`;
    usersList.appendChild(li);
    clients[id] = { el: li, color, name: displayName };
  }

  function removeUserFromList(id) {
    if (!clients[id]) return;
    clients[id].el.remove();
    delete clients[id];
    const cur = document.getElementById(`cursor-${id}`);
    if (cur) cur.remove();
  }

  function showCursor(id, x, y, color) {
    if (!clients[id]) addUserToList(id, color, id === myUserId, null);
    let el = document.getElementById(`cursor-${id}`);
    if (!el) {
      el = document.createElement('div');
      el.id = `cursor-${id}`;
      el.className = 'cursor';
      const name = (clients[id] && clients[id].name) ? clients[id].name : (id === myUserId ? 'You' : id.slice(0,6));
      el.innerHTML = `<div class="dot" style="background:${color || '#999'}"></div><div class="name">${name}</div>`;
      el.style.position = 'absolute';
      el.style.pointerEvents = 'none';
      el.style.zIndex = '9999';
      cursorLayer.appendChild(el);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    clearTimeout(el.hideTimer);
    el.hideTimer = setTimeout(() => { el.remove(); }, 3500);
  }

  // ----- reactions (floating emojis) -----
  function spawnFloatingEmoji(emoji) {
    const el = document.createElement('div');
    el.textContent = emoji;
    el.style.position = 'fixed';
    el.style.left = `${10 + Math.random() * 80}vw`;
    el.style.top = '0';
    el.style.fontSize = `${20 + Math.random() * 20}px`;
    el.style.zIndex = 99999;
    el.style.pointerEvents = 'none';
    el.style.transition = 'transform 1.8s linear, opacity 1.8s';
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = `translateY(${window.innerHeight + 80}px) rotate(${Math.random() * 720}deg)`;
      el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), 1900);
  }

  if (reactionButtons.length) {
    reactionButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji || btn.textContent || '👍';
        spawnFloatingEmoji(emoji);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'reaction', userId: myUserId, emoji }));
        }
      });
    });
  }

  // ----- room / session helpers -----
  function joinRoom(room) {
    room = String(room || 'default');
    currentRoom = room;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'join-room', room }));
      console.log('Requested join room:', room);
    } else {
      // wait for open
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'join-room', room }));
      }, { once: true });
    }
  }

  if (joinRoomBtn && roomInput) {
    joinRoomBtn.addEventListener('click', () => {
      const r = roomInput.value.trim() || 'default';
      joinRoom(r);
    });
  }

  if (saveSessionBtn) {
    saveSessionBtn.addEventListener('click', () => {
      if (socket.readyState === WebSocket.OPEN) {
        const payload = { type: 'save-session', room: currentRoom || 'default', strokes, meta: { savedBy: (nameInput && nameInput.value) || 'unknown', ts: Date.now() } };
        socket.send(JSON.stringify(payload));
      }
    });
  }
  if (loadSessionBtn) {
    loadSessionBtn.addEventListener('click', () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'load-session', room: currentRoom || 'default' }));
      }
    });
  }

  // ----- ping/pong (RTT) -----
  function sendPing() {
    if (socket.readyState === WebSocket.OPEN) {
      const t0 = Date.now();
      socket.send(JSON.stringify({ type: 'ping', ts: t0 }));
      // pong handling will compute RTT when we get the pong message
    }
  }
  setInterval(sendPing, 3000);

  // ----- FPS overlay -----
  if (fpsBadge) {
    const lastFrameTimes = [];
    function fpsTick() {
      const now = performance.now();
      lastFrameTimes.push(now);
      while (lastFrameTimes.length > 0 && lastFrameTimes[0] <= now - 1000) lastFrameTimes.shift();
      fpsBadge.textContent = `FPS: ${lastFrameTimes.length}`;
      requestAnimationFrame(fpsTick);
    }
    requestAnimationFrame(fpsTick);
  }

  // ----- socket message handler -----
  socket.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }

    // handle ping-response first
    if (msg.type === 'pong' && typeof msg.ts === 'number') {
      if (rttBadge) {
        const rtt = Date.now() - msg.ts;
        rttBadge.textContent = `RTT: ${rtt} ms`;
      }
      return;
    }

    switch (msg.type) {
      case 'init':
        // initial connection snapshot (default room)
        myUserId = msg.userId;
        myColor = msg.color || myColor;
        if (colorEl) colorEl.value = myColor;

        currentRoom = msg.room || currentRoom;

        if (Array.isArray(msg.users)) {
          msg.users.forEach(u => addUserToList(u.userId, u.color, u.userId === myUserId, u.name || null));
        }
        strokes = Array.isArray(msg.strokes) ? msg.strokes.slice() : [];
        redrawAll();
        addUserToList(myUserId, myColor, true, null);

        // send stored name if any
        const chosenName = (nameInput && nameInput.value && nameInput.value.trim()) ? nameInput.value.trim() : null;
        if (chosenName && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'set-name', userId: myUserId, name: chosenName }));
        break;

      case 'init-room':
        // joining a specific room: server provides saved strokes
        currentRoom = msg.room || currentRoom;
        strokes = Array.isArray(msg.strokes) ? msg.strokes.slice() : [];
        redrawAll();
        break;

      case 'stroke':
        strokes.push(msg.stroke);
        drawStrokeImmediate(msg.stroke);
        break;

      case 'cursor':
        showCursor(msg.userId, msg.x, msg.y, msg.color);
        break;

      case 'reaction':
        spawnFloatingEmoji(msg.emoji || '👍');
        break;

      case 'user-joined':
        addUserToList(msg.userId, msg.color, msg.userId === myUserId, msg.name || null);
        break;

      case 'user-left':
        removeUserFromList(msg.userId);
        break;

      case 'clear':
        strokes = [];
        clearCanvas();
        break;

      case 'undo':
        if (msg.removedId) {
          const idx = strokes.findIndex(s => s.id === msg.removedId);
          if (idx >= 0) strokes.splice(idx, 1);
        } else {
          for (let i = strokes.length - 1; i >= 0; i--) {
            if (strokes[i].userId === msg.userId) { strokes.splice(i,1); break; }
          }
        }
        redrawAll();
        break;

      case 'load-ack':
        if (msg.room === currentRoom) {
          strokes = Array.isArray(msg.strokes) ? msg.strokes.slice() : [];
          redrawAll();
        }
        break;

      case 'save-ack':
        // Optional: show toast or console info
        console.log('save-ack', msg);
        break;

      default:
        // ignore unknown types
        break;
    }
  });

  // ----- startup -----
  function init() {
    resize();
    window.addEventListener('resize', resize);
  }
  init();

  // expose a tiny debug object
  window.__collab = { strokes, clients, socket, joinRoom, spawnFloatingEmoji, redrawAll };
})();
