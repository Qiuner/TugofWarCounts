const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
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
const clients = new Map();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => chars[randomInt(0, chars.length - 1)]).join("");
  } while (rooms.has(code));
  return code;
}

function createClientId() {
  return crypto.randomBytes(8).toString("hex");
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

function createRoom(hostClient, payload) {
  const code = createRoomCode();
  const config = sanitizeConfig(payload || {});
  const room = {
    code,
    hostId: hostClient.id,
    config,
    players: {
      blue: hostClient.id,
      red: null
    },
    state: initialRoomState(config)
  };

  rooms.set(code, room);
  hostClient.roomCode = code;
  hostClient.team = "blue";
  return room;
}

function serializeRoomFor(client) {
  const room = rooms.get(client.roomCode);
  if (!room) {
    return null;
  }

  const state = room.state;
  const opponentTeam = client.team === "blue" ? "red" : "blue";
  const now = Date.now();
  const timeLeftMs = state.endsAt ? Math.max(0, state.endsAt - now) : room.config.duration * 1000;
  const players = {
    blue: room.players.blue ? clients.get(room.players.blue)?.name || "玩家1" : null,
    red: room.players.red ? clients.get(room.players.red)?.name || "玩家2" : null
  };

  return {
    type: "room:state",
    roomCode: room.code,
    phase: state.phase,
    team: client.team,
    isHost: room.hostId === client.id,
    players,
    config: state.configSnapshot,
    scores: state.scores,
    totalAnswered: state.totalAnswered,
    ropePos: state.ropePos,
    timeLeftMs,
    currentQuestion: state.currentQuestion[client.team]
      ? { text: state.currentQuestion[client.team].text }
      : null,
    opponentQuestionActive: Boolean(state.currentQuestion[opponentTeam]),
    result: state.lastResult[client.team],
    opponentResult: state.lastResult[opponentTeam],
    winner: state.winner
  };
}

function send(client, payload) {
  if (!client || client.socket.readyState !== 1) {
    return;
  }
  client.socket.send(JSON.stringify(payload));
}

function broadcastRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  ["blue", "red"].forEach((team) => {
    const clientId = room.players[team];
    if (!clientId) {
      return;
    }
    const client = clients.get(clientId);
    if (!client) {
      return;
    }
    const payload = serializeRoomFor(client);
    if (payload) {
      send(client, payload);
    }
  });
}

function endGame(room, winner) {
  if (room.state.gameEnded) {
    return;
  }

  room.state.gameEnded = true;
  room.state.phase = "finished";
  room.state.winner = winner;
  if (room.state.timer) {
    clearInterval(room.state.timer);
    room.state.timer = null;
  }
}

function startGame(room) {
  room.state = initialRoomState(room.config);
  room.state.phase = "playing";
  room.state.startedAt = Date.now();
  room.state.endsAt = room.state.startedAt + room.config.duration * 1000;
  nextQuestion(room, "blue");
  nextQuestion(room, "red");

  room.state.timer = setInterval(() => {
    if (Date.now() >= room.state.endsAt) {
      const winner = room.state.scores.blue >= room.state.scores.red ? "blue" : "red";
      endGame(room, winner);
    }
    broadcastRoom(room.code);
  }, 250);
}

function handleSubmit(client, payload) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state.phase !== "playing" || room.state.gameEnded) {
    return;
  }

  const team = client.team;
  if (!team) {
    return;
  }

  const current = room.state.currentQuestion[team];
  if (!current) {
    return;
  }

  room.state.totalAnswered[team] += 1;
  const submitted = Number(payload.answer);
  const correct = Number.isFinite(submitted) && submitted === current.answer;
  room.state.lastResult[team] = { type: correct ? "correct" : "wrong", at: Date.now() };

  if (correct) {
    room.state.scores[team] += 1;
    room.state.ropePos += team === "blue" ? -10 : 10;
    room.state.ropePos = clamp(room.state.ropePos, -70, 70);

    if (room.state.scores[team] >= room.config.targetQuestions) {
      endGame(room, team);
    } else if (Math.abs(room.state.ropePos) >= 60) {
      endGame(room, room.state.ropePos > 0 ? "red" : "blue");
    } else {
      nextQuestion(room, team);
    }
  }

  if (!room.state.gameEnded && Date.now() >= room.state.endsAt) {
    const winner = room.state.scores.blue >= room.state.scores.red ? "blue" : "red";
    endGame(room, winner);
  }

  broadcastRoom(room.code);
}

function leaveRoom(client) {
  const roomCode = client.roomCode;
  if (!roomCode) {
    return;
  }

  const room = rooms.get(roomCode);
  client.roomCode = null;
  client.team = null;
  if (!room) {
    return;
  }

  if (room.players.blue === client.id) {
    room.players.blue = null;
  }
  if (room.players.red === client.id) {
    room.players.red = null;
  }

  if (room.state.timer) {
    clearInterval(room.state.timer);
    room.state.timer = null;
  }

  if (!room.players.blue && !room.players.red) {
    rooms.delete(room.code);
  } else {
    room.state.phase = "lobby";
    room.state.gameEnded = false;
    room.state.winner = null;
    broadcastRoom(room.code);
  }
}

function detachClient(client) {
  leaveRoom(client);
  clients.delete(client.id);
}

function handleMessage(client, rawMessage) {
  let message;
  try {
    message = JSON.parse(rawMessage.toString());
  } catch (error) {
    send(client, { type: "error", message: "消息格式错误" });
    return;
  }

  switch (message.type) {
    case "hello":
      client.name = typeof message.name === "string" && message.name.trim() ? message.name.trim().slice(0, 16) : "玩家";
      send(client, { type: "hello:ok", clientId: client.id, name: client.name });
      break;
    case "room:create": {
      if (client.roomCode) {
        send(client, { type: "error", message: "你已经在房间中" });
        return;
      }
      const room = createRoom(client, message.config || {});
      broadcastRoom(room.code);
      break;
    }
    case "room:join": {
      if (client.roomCode) {
        send(client, { type: "error", message: "你已经在房间中" });
        return;
      }
      const code = String(message.roomCode || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        send(client, { type: "error", message: "房间不存在" });
        return;
      }
      if (room.players.red && room.players.blue) {
        send(client, { type: "error", message: "房间已满" });
        return;
      }
      const team = room.players.blue ? "red" : "blue";
      room.players[team] = client.id;
      client.roomCode = room.code;
      client.team = team;
      broadcastRoom(room.code);
      break;
    }
    case "room:leave": {
      leaveRoom(client);
      send(client, { type: "room:left" });
      break;
    }
    case "room:update-config": {
      const room = rooms.get(client.roomCode);
      if (!room) {
        return;
      }
      if (room.hostId !== client.id) {
        send(client, { type: "error", message: "只有房主可以修改配置" });
        return;
      }
      if (room.state.phase !== "lobby") {
        send(client, { type: "error", message: "比赛开始后不能修改配置" });
        return;
      }
      room.config = sanitizeConfig(message.config || {});
      room.state.configSnapshot = {
        duration: room.config.duration,
        targetQuestions: room.config.targetQuestions,
        difficulty: room.config.difficulty
      };
      broadcastRoom(room.code);
      break;
    }
    case "game:start": {
      const room = rooms.get(client.roomCode);
      if (!room) {
        return;
      }
      if (room.hostId !== client.id) {
        send(client, { type: "error", message: "只有房主可以开始" });
        return;
      }
      if (!room.players.blue || !room.players.red) {
        send(client, { type: "error", message: "需要两名玩家才能开始" });
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
      send(client, { type: "error", message: "未知消息类型" });
      break;
  }
}

function safeResolve(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
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
    id: createClientId(),
    socket,
    roomCode: null,
    team: null,
    name: "玩家"
  };

  clients.set(client.id, client);
  send(client, { type: "welcome", clientId: client.id });

  socket.on("message", (message) => handleMessage(client, message));
  socket.on("close", () => detachClient(client));
  socket.on("error", () => detachClient(client));
});

server.listen(PORT, () => {
  console.log(`TugofWarCounts online server running at http://localhost:${PORT}`);
});
