

## FLAM Real-Time Collaborative Canvas — Architecture

     This document explains how the collaborative canvas is designed and implemented: folder structure, data flow, WebSocket protocol, undo/redo strategy, performance decisions, and conflict resolution.



## Project structure (logical):

 collaborative-canvas/
├── client/
│ ├── index.html # UI and toolbar
│ ├── style.css # Styling & responsive rules
│ └── app.js # Canvas logic + WebSocket client + UI glue
├── server/
│ └── server.js # Express static server + ws WebSocket server
├── sessions/ # (created at runtime) persisted room files .json
├── package.json
├── README.md
└── ARCHITECTURE.md




## Data Flow Diagram — how drawing events flow

    High-level flow (sequence)
```mermaid
sequenceDiagram
  participant UserA as Browser A (client)
  participant Server as Node/Express + WebSocket
  participant UserB as Browser B (client)

  UserA->>Server: WebSocket "stroke" { stroke object }
  Server-->>UserB: Broadcast "stroke" { stroke object }
  UserB->>Canvas: drawStrokeImmediate(stroke)
  ```


1] Client (app.js)

   * Capture user input (pointer events).

   * Create stroke objects (id, userId, color, width, points[]).

   * Send messages to server via WebSocket.

   * Render incoming strokes & update local state (strokes[]).

2] Server (server.js)

   * Accept WebSocket connections.

   * Maintain room membership and per-room stroke buffers.

   * Receive client messages, apply minimal validation, persist (optional), and broadcast to room peers.

3] Persistence (sessions/)

   * Optional save/load for rooms (JSON files created by save-session).


WebSocket Protocol — messages you send/receive:

   All messages are JSON. type identifies message intent. Below are the primary messages used by           client and server.

Client → Server (examples)

   * init — handled by server on connection (server sends init to client)

   * join-room
   { "type":"join-room", "room":"team-a" }

   * stroke — send full stroke after finishing the stroke (or batched segments)
     {
        "type":"stroke",
        "stroke": {
        "id": "1600000000-abc",
        "userId": "uuid-123",
        "color":"#0ea5e9",
        "width":4,
        "points":[{"x":10,"y":20},{"x":14,"y":22}, ... ],
        "ts": 1690000000000
        }
     }

 * cursor — lightweight frequent updates
       { "type":"cursor", "userId":"uuid-123", "x": 150, "y": 200, "color":"#0ea5e9" }

 * clear

       { "type":"clear", "userId":"uuid-123" }


 * undo

       { "type":"undo", "userId":"uuid-123" }


 * set-name

       { "type":"set-name", "userId":"uuid-123", "name":"Raj" }


 * reaction

       { "type":"reaction", "userId":"uuid-123", "emoji":"🎉", "x":120, "y":40 }


 * save-session

       { "type":"save-session", "room":"team-a", "strokes": [...], "meta": { "savedBy":"Raj", "ts": 1690000000000 } }


* load-session

       { "type":"load-session", "room":"team-a" }


 * ping

       { "type":"ping", "ts": 1690000000000 }

Server → Client (examples)

 * init (on connect)

        { "type":"init", "userId":"uuid-123", "color":"#0ea5e9", "room":"default", "strokes":[ ... ], "users":[ { "userId": "...", "name": "...", "color":"..." } ] }


 * init-room (on join-room)

         { "type":"init-room", "room":"team-a", "strokes":[ ... ], "meta": { ... } }


*stroke (broadcast)

         { "type":"stroke", "stroke": { ... } }


 * cursor (broadcast)

         { "type":"cursor", "userId":"uuid-234", "x":150, "y":200, "color":"#..." }


 * user-joined / user-left (presence updates)

          { "type":"user-joined", "userId":"uuid-234", "name":"Sita", "color":"#..." }
          { "type":"user-left", "userId":"uuid-234" }


* undo / clear (broadcast)

           { "type":"undo", "userId":"uuid-234", "removedId":"1600000000-abc" }
           { "type":"clear" }


 * load-ack / save-ack / pong

           { "type":"load-ack", "room":"team-a", "strokes":[ ... ] }
           { "type":"save-ack", "ok":true, "room":"team-a" }
           { "type":"pong", "ts": 1690000000000 }


Keep messages small and compact; for strokes consider sending batched segments or final strokes to reduce network overhead.



## Undo / Redo strategy (global operations) 

1] The assignment requests global undo/redo semantics. Current implemented approach:

2] Current (safe & simple) behavior:

3] Undo removes the last stroke by that user in the current room.

4] Client sends {type:'undo', userId}.

5] Server finds the most recent stroke in roomStrokes[room] whose userId matches and removes it.

6] Server broadcasts {type:'undo', userId, removedId} to the room.

7] Clients update local strokes[] by removing that removedId.


## Why this approach:

It is deterministic and avoids complex operational transforms for global shared history.

Matches many real-time whiteboards expectations: each user controls undo for their own actions.


 Notes / future improvements:

  Global undo (time-ordered): requires an agreed total ordering and careful conflict handling — can be implemented by maintaining a global operation log and applying causality; more complex.

  Redo: not currently implemented; can be supported by storing per-user undo stacks (on server or client), pushing removed strokes to a per-user redo stack and broadcasting redo events.


## Performance Decisions & Optimizations

1] Network

   Use WebSocket (native ws) for low-latency bidirectional messages.

   Throttling: client limits stroke segment sends (e.g., send final stroke or small batches, throttle continuous segments to ~10–15 msgs/sec).

   Compact messages: stroke points are arrays of {x,y} numbers (no verbose keys in per-point objects if you compress further).

   Cursor updates are lightweight and frequent — broadcast every pointer move but throttled on client-side to reduce churn.

2] Rendering

   RequestAnimationFrame for any continuous UI animation (FPS measurement and redraw loops).

   Partial drawing: draw only the newest segment on pointermove to keep UI responsive, then on pointerup push final stroke and redraw full canvas.

   DevicePixelRatio scaling: canvas scaled to DPR for crisp lines (especially for mobile high-DPI screens).

3] Server

   In-memory room buffers (roomStrokes map) to reduce disk I/O; write to disk only on explicit save-session requests to sessions/*.

   Room-scoped broadcasts: send messages only to peers in the same room to reduce unnecessary network traffic.

   Stateless scaling: for multiple instances (not required for assignment), sessions should be stored in a shared DB and WebSocket messages routed through a pub/sub system (Redis) to replicate broadcasts across instances.



## Conflict Resolution (simultaneous drawing)

Simultaneous drawing on the same area is common. The app uses these strategies:

1] Default (event-merge)

   Strokes are independent immutable objects. When multiple users draw at once:

   Each stroke is appended to room stroke buffer with a timestamp.

   Clients render strokes in arrival order — typically matches the user's expectations.

   Because strokes are additive, conflicts are minimal (no lost data). Overlaps are acceptable in most whiteboard usage.

2] Handling overlapping edits (advanced)

  Layering: strokes are rendered in the order they arrived; if you want deterministic ordering, use server-assigned monotonic sequence numbers.

  Undo semantics: undo removes specific stroke IDs (not "erase pixel ranges"), preventing accidental removal of others' work.

  Eraser tool: implemented by painting white strokes (same as pen but with background color). If you want true object-level erasure, you must implement vectorized objects rather than raw pixel strokes.

3] Edge cases & mitigation

   Network latency differences: the app uses client-side immediate drawing (local echo) combined with optimistic updates — the user's own drawing appears immediately while peers receive it shortly after.

   Server authoritative operations: server is canonical for room state; if a client reconnects it receives an init-room snapshot to resync.



## Security & Practical Notes:

 Input sanitization: trim and limit name length to avoid abuse. Room names sanitized before file I/O.

 Persistence: sessions/ files are JSON and saved only when save-session is called. For production use, move to a database and authenticate save access.

 Resource limits: large numbers of strokes may grow memory; consider chunking or trimming strategy for long sessions.

## Testing & Debugging tips

    Use two devices (desktop + mobile) with same room to validate real-time sync and touch drawing.

    Use ngrok during local dev to test cross-device without deploying.

    Check RTT (ping/pong) to estimate expected sync lag and use FPS overlay to measure rendering performance.

    For load testing, simulate many WebSocket clients locally (scripts) to observe server memory & broadcast performance


## Summary / Rationale

  The design balances simplicity (native WebSockets, additive strokes) with essential real-time behaviors (cursor presence, per-room scoping, save/load).

  Undo-by-user is safe and predictable; advanced OT/CRDT approaches are available but out of scope for the assignment timeframe.

  Performance choices (throttling, DPR scaling, room broadcasts) prioritize smooth UX across mobile and desktop while keeping the server lightweight.


## Contact / author

   Raj R — implemented client & server (Vanilla JS + Node/Express + ws).


