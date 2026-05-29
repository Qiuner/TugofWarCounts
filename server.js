const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS) || 10 * 60 * 1000;
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 30 * 1000;
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS) || 15 * 1000;
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS) || 20 * 1000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel"
};

const DIFFICULTIES = [
  "10以内加法",
  "10以内减法",
  "20以内加法",
  "20以内减法",
  "100以内加法",
  "100以内减法",
  "1000以内加法",
  "1000以内减法",
  "表内乘法",
  "表内除法",
  "100以内乘法",
  "100以内除法",
  "万以内加法",
  "万以内减法"
];

const rooms = new Map();
const liveClients = new Map();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function now() {
  return Date.now();
}

function createRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => chars[randomInt(0, chars.length - 1)]).join("");
  } while (rooms.has(code));
  return code;
}

function createId(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

function roomUrl(roomCode) {
  return `/public/index.html?room=${encodeURIComponent(roomCode)}`;
}

function createQuestionBank(config) {
  if (Array.isArray(config.importedQuestions) && config.importedQuestions.length > 0) {
    return config.importedQuestions
      .filter((item) => item && typeof item.text === "string" && Number.isFinite(Number(item.answer)))
      .map((item) => ({ text: item.text.trim(), answer: Number(item.answer) }))
      .filter((item) => item.text);
  }
  return [];
}

function generateQuestion(difficulty, lastText) {
  for (let i = 0; i < 50; i += 1) {
    let a;
    let b;
    let text = "";
    let answer = 0;

    switch (difficulty) {
      case "10以内加法":
        a = randomInt(1, 9);
        b = randomInt(0, 10 - a);
        text = `${a} + ${b}`;
        answer = a + b;
        break;
      case "10以内减法":
        a = randomInt(1, 10);
        b = randomInt(0, a);
        text = `${a} - ${b}`;
        answer = a - b;
        break;
      case "20以内加法":
        a = randomInt(1, 19);
        b = randomInt(0, 20 - a);
        text = `${a} + ${b}`;
        answer = a + b;
        break;
      case "20以内减法":
        a = randomInt(1, 20);
        b = randomInt(0, a);
        text = `${a} - ${b}`;
        answer = a - b;
        break;
      case "100以内加法":
        a = randomInt(1, 99);
        b = randomInt(0, 100 - a);
        text = `${a} + ${b}`;
        answer = a + b;
        break;
      case "100以内减法":
        a = randomInt(1, 100);
        b = randomInt(0, a);
        text = `${a} - ${b}`;
        answer = a - b;
        break;
      case "1000以内加法":
        a = randomInt(1, 999);
        b = randomInt(0, 1000 - a);
        text = `${a} + ${b}`;
        answer = a + b;
        break;
      case "1000以内减法":
        a = randomInt(1, 1000);
        b = randomInt(0, a);
        text = `${a} - ${b}`;
        answer = a - b;
        break;
      case "表内乘法":
        a = randomInt(1, 9);
        b = randomInt(1, 9);
        text = `${a} × ${b}`;
        answer = a * b;
        break;
      case "表内除法":
        b = randomInt(1, 9);
        answer = randomInt(1, 9);
        a = b * answer;
        text = `${a} ÷ ${b}`;
        break;
      case "100以内乘法":
        a = randomInt(1, 10);
        b = randomInt(1, Math.floor(100 / a));
        text = `${a} × ${b}`;
        answer = a * b;
        break;
      case "100以内除法":
        b = randomInt(1, 10);
        answer = randomInt(1, Math.floor(100 / b));
        a = b * answer;
        text = `${a} ÷ ${b}`;
        break;
      case "万以内加法":
        a = randomInt(1, 9999);
        b = randomInt(0, 10000 - a);
        text = `${a} + ${b}`;
        answer = a + b;
        break;
      case "万以内减法":
        a = randomInt(1, 10000);
        b = randomInt(0, a);
        text = `${a} - ${b}`;
        answer = a - b;
        break;
      default:
        text = "1 + 1";
        answer = 2;
        break;
    }

    if (text !== lastText) {
      return { text, answer };
    }
  }

  return { text: "1 + 1", answer: 2 };
}

function createPlayerSlot(sessionId, name) {
  return {
    sessionId,
    name,
    connected: true,
    disconnectedAt: null,
    reconnectUntil: null
  };
}

function sanitizeConfig(input) {
  const duration = clamp(Number(input.duration) || 45, 30, 180);
  const targetQuestions = clamp(Number(input.targetQuestions) || 10, 1, 50);
  const difficulty = DIFFICULTIES.includes(input.difficulty) ? input.difficulty : "10以内加法";
  const importedQuestions = Array.isArray(input.importedQuestions) ? input.importedQuestions : [];

  return {
    duration,
    targetQuestions,
    difficulty,
    importedQuestions,
    questionBank: createQuestionBank({ importedQuestions })
  };
}

function initialRoomState(config) {
  return {
    phase: "lobby",
    startedAt: null,
    endsAt: null,
    timer: null,
    gameEnded: false,
    winner: null,
    scores: { blue: 0, red: 0 },
    totalAnswered: { blue: 0, red: 0 },
    ropePos: 0,
    currentQuestion: { blue: null, red: null },
    lastQuestionText: { blue: "", red: "" },
    lastResult: {
      blue: { type: "idle", at: 0 },
      red: { type: "idle", at: 0 }
    },
    configSnapshot: {
      duration: config.duration,
      targetQuestions: config.targetQuestions,
      difficulty: config.difficulty
    }
  };
}

function touchRoom(room) {
  room.updatedAt = now();
}

function getPlayerSlot(room, team) {
  return room.players[team];
}

function getTeamBySession(room, sessionId) {
  if (room.players.blue && room.players.blue.sessionId === sessionId) {
    return "blue";
  }
  if (room.players.red && room.players.red.sessionId === sessionId) {
    return "red";
  }
  return null;
}

function getConnectedClient(sessionId) {
  return liveClients.get(sessionId) || null;
}

function sendToSession(sessionId, payload) {
  const client = getConnectedClient(sessionId);
  if (!client || client.socket.readyState !== 1) {
    return;
  }
  client.socket.send(JSON.stringify(payload));
}

function nextQuestion(room, team) {
  const state = room.state;
  const bank = room.config.questionBank;

  if (bank.length > 0) {
    const lastText = state.lastQuestionText[team];
    const choices = bank.filter((item) => item.text !== lastText);
    const source = choices.length > 0 ? choices : bank;
    const pick = source[randomInt(0, source.length - 1)];
    state.lastQuestionText[team] = pick.text;
    state.currentQuestion[team] = { text: pick.text, answer: pick.answer };
    return;
  }

  const generated = generateQuestion(room.config.difficulty, state.lastQuestionText[team]);
  state.lastQuestionText[team] = generated.text;
  state.currentQuestion[team] = generated;
}

function createRoom(hostClient, payload) {
  const code = createRoomCode();
  const config = sanitizeConfig(payload || {});
  const room = {
    code,
    createdAt: now(),
    updatedAt: now(),
    hostSessionId: hostClient.sessionId,
    config,
    players: {
      blue: createPlayerSlot(hostClient.sessionId, hostClient.name),
      red: null
    },
    state: initialRoomState(config)
  };

  rooms.set(code, room);
  hostClient.roomCode = code;
  hostClient.team = "blue";
  return room;
}

function getPlayerState(slot) {
  if (!slot) {
    return null;
  }
  return {
    name: slot.name,
    connected: slot.connected,
    reconnectUntil: slot.reconnectUntil
  };
}

function serializeRoomFor(client) {
  const room = rooms.get(client.roomCode);
  if (!room || !client.team) {
    return null;
  }

  const opponentTeam = client.team === "blue" ? "red" : "blue";
  const currentTime = now();
  const timeLeftMs = room.state.endsAt ? Math.max(0, room.state.endsAt - currentTime) : room.config.duration * 1000;

  return {
    type: "room:state",
    roomCode: room.code,
    roomPath: roomUrl(room.code),
    phase: room.state.phase,
    team: client.team,
    isHost: room.hostSessionId === client.sessionId,
    players: {
      blue: getPlayerState(room.players.blue),
      red: getPlayerState(room.players.red)
    },
    config: room.state.configSnapshot,
    scores: room.state.scores,
    totalAnswered: room.state.totalAnswered,
    ropePos: room.state.ropePos,
    timeLeftMs,
    currentQuestion: room.state.currentQuestion[client.team]
      ? { text: room.state.currentQuestion[client.team].text }
      : null,
    opponentQuestionActive: Boolean(room.state.currentQuestion[opponentTeam]),
    result: room.state.lastResult[client.team],
    opponentResult: room.state.lastResult[opponentTeam],
    winner: room.state.winner,
    canStart: Boolean(room.players.blue && room.players.red),
    reconnectGraceMs: RECONNECT_GRACE_MS
  };
}

function broadcastRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  ["blue", "red"].forEach((team) => {
    const slot = room.players[team];
    if (!slot) {
      return;
    }
    const client = getConnectedClient(slot.sessionId);
    if (!client) {
      return;
    }
    const payload = serializeRoomFor(client);
    if (payload) {
      sendToSession(slot.sessionId, payload);
    }
  });
}

function clearGameTimer(room) {
  if (room.state.timer) {
    clearInterval(room.state.timer);
    room.state.timer = null;
  }
}

function endGame(room, winner) {
  if (room.state.gameEnded) {
    return;
  }

  room.state.gameEnded = true;
  room.state.phase = "finished";
  room.state.winner = winner;
  clearGameTimer(room);
  touchRoom(room);
}

function startGame(room) {
  room.state = initialRoomState(room.config);
  room.state.phase = "playing";
  room.state.startedAt = now();
  room.state.endsAt = room.state.startedAt + room.config.duration * 1000;
  nextQuestion(room, "blue");
  nextQuestion(room, "red");
  touchRoom(room);

  room.state.timer = setInterval(() => {
    if (now() >= room.state.endsAt) {
      const winner = room.state.scores.blue >= room.state.scores.red ? "blue" : "red";
      endGame(room, winner);
    }
    broadcastRoom(room.code);
  }, 250);
}

function assignHost(room) {
  if (room.players.blue) {
    room.hostSessionId = room.players.blue.sessionId;
    return;
  }
  if (room.players.red) {
    room.hostSessionId = room.players.red.sessionId;
    return;
  }
  room.hostSessionId = null;
}

function removePlayerFromRoom(room, team) {
  const slot = room.players[team];
  if (!slot) {
    return;
  }

  room.players[team] = null;
  room.state.currentQuestion[team] = null;
  room.state.lastQuestionText[team] = "";
  room.state.lastResult[team] = { type: "idle", at: 0 };

  if (room.hostSessionId === slot.sessionId) {
    assignHost(room);
  }

  if (!room.players.blue && !room.players.red) {
    clearGameTimer(room);
    rooms.delete(room.code);
    return;
  }

  clearGameTimer(room);
  room.state.phase = "lobby";
  room.state.gameEnded = false;
  room.state.winner = null;
  room.state.currentQuestion = { blue: null, red: null };
  touchRoom(room);
}

function leaveRoom(client) {
  const roomCode = client.roomCode;
  if (!roomCode) {
    client.roomCode = null;
    client.team = null;
    return;
  }

  const room = rooms.get(roomCode);
  const team = client.team;
  client.roomCode = null;
  client.team = null;
  if (!room || !team) {
    return;
  }

  removePlayerFromRoom(room, team);
  if (rooms.has(roomCode)) {
    broadcastRoom(roomCode);
  }
}

function disconnectClient(client) {
  liveClients.delete(client.sessionId);
  if (!client.roomCode || !client.team) {
    return;
  }

  const room = rooms.get(client.roomCode);
  if (!room) {
    return;
  }

  const slot = getPlayerSlot(room, client.team);
  if (!slot || slot.sessionId !== client.sessionId) {
    return;
  }

  slot.connected = false;
  slot.disconnectedAt = now();
  slot.reconnectUntil = slot.disconnectedAt + RECONNECT_GRACE_MS;

  clearGameTimer(room);
  if (room.state.phase === "playing") {
    room.state.phase = "lobby";
  }
  touchRoom(room);
  broadcastRoom(room.code);
}

function restoreClientMembership(client) {
  for (const room of rooms.values()) {
    const team = getTeamBySession(room, client.sessionId);
    if (!team) {
      continue;
    }
    const slot = getPlayerSlot(room, team);
    slot.connected = true;
    slot.disconnectedAt = null;
    slot.reconnectUntil = null;
    slot.name = client.name;
    client.roomCode = room.code;
    client.team = team;
    touchRoom(room);
    return room;
  }
  return null;
}

function attachClientToSlot(client, room, team) {
  const slot = getPlayerSlot(room, team);
  slot.connected = true;
  slot.disconnectedAt = null;
  slot.reconnectUntil = null;
  slot.name = client.name;
  client.roomCode = room.code;
  client.team = team;
  touchRoom(room);
}

function handleSubmit(client, payload) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state.phase !== "playing" || room.state.gameEnded || !client.team) {
    return;
  }

  const current = room.state.currentQuestion[client.team];
  if (!current) {
    return;
  }

  room.state.totalAnswered[client.team] += 1;
  const submitted = Number(payload.answer);
  const correct = Number.isFinite(submitted) && submitted === current.answer;
  room.state.lastResult[client.team] = { type: correct ? "correct" : "wrong", at: now() };

  if (correct) {
    room.state.scores[client.team] += 1;
    room.state.ropePos += client.team === "blue" ? -10 : 10;
    room.state.ropePos = clamp(room.state.ropePos, -70, 70);

    if (room.state.scores[client.team] >= room.config.targetQuestions) {
      endGame(room, client.team);
    } else if (Math.abs(room.state.ropePos) >= 60) {
      endGame(room, room.state.ropePos > 0 ? "red" : "blue");
    }
  }

  if (!room.state.gameEnded && now() >= room.state.endsAt) {
    const winner = room.state.scores.blue >= room.state.scores.red ? "blue" : "red";
    endGame(room, winner);
  }

  if (!room.state.gameEnded) {
    nextQuestion(room, client.team);
  }

  touchRoom(room);
  broadcastRoom(room.code);
}

function handleMessage(client, rawMessage) {
  let message;
  try {
    message = JSON.parse(rawMessage.toString());
  } catch (error) {
    sendToSession(client.sessionId, { type: "error", message: "消息格式错误" });
    return;
  }

  switch (message.type) {
    case "hello": {
      const requestedSessionId = typeof message.sessionId === "string" && /^[a-f0-9]{32}$/i.test(message.sessionId)
        ? message.sessionId
        : createId();

      if (requestedSessionId !== client.sessionId) {
        liveClients.delete(client.sessionId);
        client.sessionId = requestedSessionId;
        liveClients.set(client.sessionId, client);
      }

      client.name = typeof message.name === "string" && message.name.trim()
        ? message.name.trim().slice(0, 16)
        : "玩家";
      const room = restoreClientMembership(client);
      sendToSession(client.sessionId, {
        type: "hello:ok",
        sessionId: client.sessionId,
        name: client.name
      });
      if (room) {
        broadcastRoom(room.code);
      }
      break;
    }
    case "room:create": {
      if (client.roomCode) {
        sendToSession(client.sessionId, { type: "error", message: "你已经在房间中" });
        return;
      }
      const room = createRoom(client, message.config || {});
      broadcastRoom(room.code);
      break;
    }
    case "room:join": {
      if (client.roomCode) {
        sendToSession(client.sessionId, { type: "error", message: "你已经在房间中" });
        return;
      }
      const code = String(message.roomCode || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendToSession(client.sessionId, { type: "error", message: "房间不存在或已过期" });
        return;
      }
      if (room.players.blue && room.players.red) {
        sendToSession(client.sessionId, { type: "error", message: "房间已满" });
        return;
      }
      const team = room.players.blue ? "red" : "blue";
      room.players[team] = createPlayerSlot(client.sessionId, client.name);
      attachClientToSlot(client, room, team);
      broadcastRoom(room.code);
      break;
    }
    case "room:leave":
      leaveRoom(client);
      sendToSession(client.sessionId, { type: "room:left" });
      break;
    case "room:update-config": {
      const room = rooms.get(client.roomCode);
      if (!room) {
        return;
      }
      if (room.hostSessionId !== client.sessionId) {
        sendToSession(client.sessionId, { type: "error", message: "只有房主可以修改配置" });
        return;
      }
      if (room.state.phase !== "lobby") {
        sendToSession(client.sessionId, { type: "error", message: "比赛开始后不能修改配置" });
        return;
      }
      room.config = sanitizeConfig(message.config || {});
      room.state.configSnapshot = {
        duration: room.config.duration,
        targetQuestions: room.config.targetQuestions,
        difficulty: room.config.difficulty
      };
      touchRoom(room);
      broadcastRoom(room.code);
      break;
    }
    case "game:start": {
      const room = rooms.get(client.roomCode);
      if (!room) {
        return;
      }
      if (room.hostSessionId !== client.sessionId) {
        sendToSession(client.sessionId, { type: "error", message: "只有房主可以开始" });
        return;
      }
      if (!room.players.blue || !room.players.red) {
        sendToSession(client.sessionId, { type: "error", message: "需要两名玩家才能开始" });
        return;
      }
      if (!room.players.blue.connected || !room.players.red.connected) {
        sendToSession(client.sessionId, { type: "error", message: "两名玩家都在线时才能开始" });
        return;
      }
      startGame(room);
      broadcastRoom(room.code);
      break;
    }
    case "answer:submit":
      handleSubmit(client, message);
      break;
    default:
      sendToSession(client.sessionId, { type: "error", message: "未知消息类型" });
      break;
  }
}

function cleanupRooms() {
  const currentTime = now();
  for (const room of rooms.values()) {
    ["blue", "red"].forEach((team) => {
      const slot = room.players[team];
      if (!slot) {
        return;
      }
      if (!slot.connected && slot.reconnectUntil && currentTime > slot.reconnectUntil) {
        removePlayerFromRoom(room, team);
      }
    });

    if (!rooms.has(room.code)) {
      continue;
    }

    const bothEmpty = !room.players.blue && !room.players.red;
    if (bothEmpty || currentTime - room.updatedAt > ROOM_IDLE_MS) {
      clearGameTimer(room);
      rooms.delete(room.code);
    }
  }
}

function safeResolve(urlPath) {
  const cleanPath = decodeURIComponent((urlPath || "/").split("?")[0]);
  if (cleanPath === "/healthz") {
    return "__healthz__";
  }
  const normalized = cleanPath === "/" ? "/public/index.html" : cleanPath;
  const absolutePath = path.normalize(path.join(ROOT, normalized));
  if (!absolutePath.startsWith(ROOT)) {
    return null;
  }
  return absolutePath;
}

const server = http.createServer((req, res) => {
  const filePath = safeResolve(req.url || "/");
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (filePath === "__healthz__") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      ok: true,
      rooms: rooms.size,
      clients: liveClients.size,
      time: new Date().toISOString()
    }));
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Server Error");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  const client = {
    id: createId(8),
    sessionId: createId(),
    socket,
    roomCode: null,
    team: null,
    name: "玩家",
    isAlive: true
  };

  liveClients.set(client.sessionId, client);
  sendToSession(client.sessionId, { type: "welcome" });

  socket.on("pong", () => {
    client.isAlive = true;
  });
  socket.on("message", (message) => handleMessage(client, message));
  socket.on("close", () => disconnectClient(client));
  socket.on("error", () => disconnectClient(client));
});

setInterval(() => {
  for (const client of liveClients.values()) {
    if (!client.isAlive) {
      try {
        client.socket.terminate();
      } catch (error) {
        disconnectClient(client);
      }
      continue;
    }
    client.isAlive = false;
    try {
      client.socket.ping();
    } catch (error) {
      disconnectClient(client);
    }
  }
}, HEARTBEAT_INTERVAL_MS);

setInterval(cleanupRooms, CLEANUP_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`TugofWarCounts online server running at http://0.0.0.0:${PORT}`);
});
