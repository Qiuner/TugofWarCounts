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

const STORAGE_KEYS = {
  sessionId: "tug_room_session_id",
  playerName: "tug_room_player_name"
};

const state = {
  socket: null,
  connected: false,
  currentRoom: null,
  currentInput: "",
  myTeam: null,
  clientName: localStorage.getItem(STORAGE_KEYS.playerName) || "玩家",
  sessionId: localStorage.getItem(STORAGE_KEYS.sessionId) || "",
  pendingAction: null,
  reconnectTimer: null,
  manualDisconnect: false,
  currentRoomCodeParam: new URLSearchParams(location.search).get("room")?.trim().toUpperCase() || ""
};

const els = {
  playerName: document.getElementById("playerName"),
  connectBtn: document.getElementById("connectBtn"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  copyRoomLinkBtn: document.getElementById("copyRoomLinkBtn"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  connectionText: document.getElementById("connectionText"),
  roomLinkText: document.getElementById("roomLinkText"),
  roomTipsText: document.getElementById("roomTipsText"),
  durationSelect: document.getElementById("durationSelect"),
  targetQuestionsInput: document.getElementById("targetQuestionsInput"),
  difficultySelect: document.getElementById("difficultySelect"),
  saveConfigBtn: document.getElementById("saveConfigBtn"),
  startGameBtn: document.getElementById("startGameBtn"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  roomCodeText: document.getElementById("roomCodeText"),
  teamText: document.getElementById("teamText"),
  phaseText: document.getElementById("phaseText"),
  bluePlayerText: document.getElementById("bluePlayerText"),
  redPlayerText: document.getElementById("redPlayerText"),
  panelLobby: document.querySelector(".panel-lobby"),
  panelGame: document.querySelector(".panel-game"),
  blueSide: document.querySelector(".blue-side"),
  redSide: document.querySelector(".red-side"),
  blueScore: document.getElementById("blueScore"),
  redScore: document.getElementById("redScore"),
  blueProgressText: document.getElementById("blueProgressText"),
  redProgressText: document.getElementById("redProgressText"),
  mySideLabelBlue: document.getElementById("mySideLabelBlue"),
  mySideLabelRed: document.getElementById("mySideLabelRed"),
  timerText: document.getElementById("timerText"),
  ropeHint: document.getElementById("ropeHint"),
  questionBlue: document.getElementById("questionBlue"),
  questionRed: document.getElementById("questionRed"),
  myQuestionCardBlue: document.getElementById("myQuestionCardBlue"),
  myQuestionCardRed: document.getElementById("myQuestionCardRed"),
  resultBlue: document.getElementById("resultBlue"),
  resultRed: document.getElementById("resultRed"),
  answerDisplay: document.getElementById("answerDisplay"),
  numpad: document.getElementById("numpad"),
  tugGroup: document.getElementById("tugGroup"),
  meTeamLabel: document.getElementById("meTeamLabel"),
  opponentStateText: document.getElementById("opponentStateText"),
  gameOverlay: document.getElementById("gameOverlay"),
  winnerText: document.getElementById("winnerText"),
  summaryText: document.getElementById("summaryText"),
  backToLobbyBtn: document.getElementById("backToLobbyBtn"),
  audioCorrect: document.getElementById("audioCorrect"),
  audioWrong: document.getElementById("audioWrong"),
  audioGameover: document.getElementById("audioGameover")
};

els.playerName.value = state.clientName;
if (state.currentRoomCodeParam) {
  els.roomCodeInput.value = state.currentRoomCodeParam;
}

function fillDifficultyOptions() {
  els.difficultySelect.innerHTML = DIFFICULTIES
    .map((item) => `<option value="${item}">${item}</option>`)
    .join("");
  els.difficultySelect.value = "10以内加法";
}

function setConnectionText(text, connected) {
  els.connectionText.textContent = text;
  els.connectionText.style.color = connected ? "#1a7f4b" : "#6d4a1e";
}

function updateLocationRoom(roomCode) {
  const url = new URL(location.href);
  if (roomCode) {
    url.searchParams.set("room", roomCode);
  } else {
    url.searchParams.delete("room");
  }
  history.replaceState({}, "", url);
}

function getFullRoomUrl(roomCode) {
  const url = new URL(location.origin);
  url.pathname = "/public/index.html";
  url.searchParams.set("room", roomCode);
  return url.toString();
}

function setPendingAction(action) {
  state.pendingAction = action;
}

function safeSend(payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    alert("尚未连接服务器");
    return false;
  }
  state.socket.send(JSON.stringify(payload));
  return true;
}

function connectSocket() {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    return;
  }
  if (state.socket && state.socket.readyState === WebSocket.CONNECTING) {
    return;
  }

  const protocol = location.protocol === "https:" ? "wss" : "ws";
  state.manualDisconnect = false;
  const socket = new WebSocket(`${protocol}://${location.host}`);
  state.socket = socket;
  setConnectionText("连接中...", false);

  socket.addEventListener("open", () => {
    state.connected = true;
    state.clientName = els.playerName.value.trim() || "玩家";
    localStorage.setItem(STORAGE_KEYS.playerName, state.clientName);
    setConnectionText("已连接", true);
    safeSend({
      type: "hello",
      name: state.clientName,
      sessionId: state.sessionId
    });
    if (typeof state.pendingAction === "function") {
      const action = state.pendingAction;
      state.pendingAction = null;
      action();
    }
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    handleMessage(message);
  });

  socket.addEventListener("close", () => {
    state.connected = false;
    state.socket = null;
    setConnectionText("连接已断开，尝试重连中...", false);
    if (!state.manualDisconnect) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = window.setTimeout(connectSocket, 1500);
    }
  });
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function renderResult(result) {
  if (!result || result.type === "idle") {
    return "等待作答";
  }
  if (result.type === "correct") {
    return "回答正确";
  }
  if (result.type === "wrong") {
    return "回答错误";
  }
  return "等待作答";
}

function renderPlayerSlot(slot) {
  if (!slot) {
    return "空位";
  }
  return `${slot.name}${slot.connected ? " · 在线" : " · 掉线"}`;
}

function playAudio(kind) {
  const audio =
    kind === "correct" ? els.audioCorrect :
    kind === "wrong" ? els.audioWrong :
    els.audioGameover;
  if (!audio) {
    return;
  }
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function showLobby() {
  els.panelLobby.style.display = "block";
  els.panelGame.style.display = "none";
}

function showGame() {
  els.panelLobby.style.display = "none";
  els.panelGame.style.display = "block";
}

function resetInput() {
  state.currentInput = "";
  els.answerDisplay.textContent = "-";
}

function updateRoomShare(roomCode) {
  if (!roomCode) {
    els.roomLinkText.textContent = "-";
    els.roomTipsText.textContent = "创建房间后可复制邀请链接给另一位玩家。";
    return;
  }
  const shareLink = getFullRoomUrl(roomCode);
  els.roomLinkText.textContent = shareLink;
  els.roomTipsText.textContent = "把这个链接发给另一位玩家，对方打开后会自动带上房间号。";
}

function handleRoomState(message) {
  const prev = state.currentRoom;
  const prevResult = prev ? prev.result?.type : null;
  state.currentRoom = message;
  state.myTeam = message.team;

  updateLocationRoom(message.roomCode);
  updateRoomShare(message.roomCode);

  els.roomCodeText.textContent = message.roomCode;
  els.roomCodeInput.value = message.roomCode;
  els.teamText.textContent = message.team === "blue" ? "蓝队" : "红队";
  els.phaseText.textContent = message.phase;
  els.bluePlayerText.textContent = renderPlayerSlot(message.players.blue);
  els.redPlayerText.textContent = renderPlayerSlot(message.players.red);

  els.durationSelect.value = String(message.config.duration);
  els.targetQuestionsInput.value = String(message.config.targetQuestions);
  els.difficultySelect.value = message.config.difficulty;

  const editable = message.isHost && message.phase === "lobby";
  [els.durationSelect, els.targetQuestionsInput, els.difficultySelect, els.saveConfigBtn]
    .forEach((el) => { el.disabled = !editable; });
  els.startGameBtn.disabled = !(editable && message.canStart);
  els.copyRoomLinkBtn.disabled = !message.roomCode;

  const inGame = message.phase === "playing" || message.phase === "finished";
  if (inGame) {
    showGame();
  } else {
    showLobby();
  }

  els.blueScore.textContent = message.scores.blue;
  els.redScore.textContent = message.scores.red;
  els.blueProgressText.textContent = `答 ${message.totalAnswered.blue} / ${message.config.targetQuestions}`;
  els.redProgressText.textContent = `答 ${message.totalAnswered.red} / ${message.config.targetQuestions}`;
  els.timerText.textContent = formatTime(message.timeLeftMs);
  els.tugGroup.style.transform = `translateX(${message.ropePos * 3.2}px)`;
  els.ropeHint.textContent = message.phase === "playing" ? "比赛进行中" : "等待房主开始比赛";
  els.meTeamLabel.textContent = message.team === "blue" ? "你是蓝队" : "你是红队";
  els.mySideLabelBlue.textContent = message.team === "blue" ? "你的蓝队" : "蓝队";
  els.mySideLabelRed.textContent = message.team === "red" ? "你的红队" : "红队";

  els.blueSide?.classList.toggle("active-side", message.team === "blue");
  els.redSide?.classList.toggle("active-side", message.team === "red");
  els.blueSide?.classList.toggle("opponent-side", message.team !== "blue");
  els.redSide?.classList.toggle("opponent-side", message.team !== "red");

  const opponentSlot = message.team === "blue" ? message.players.red : message.players.blue;
  if (!opponentSlot) {
    els.opponentStateText.textContent = "等待另一位玩家加入";
  } else if (!opponentSlot.connected) {
    els.opponentStateText.textContent = "对手掉线，等待重连";
  } else if (message.opponentResult?.type === "correct") {
    els.opponentStateText.textContent = "对手刚答对";
  } else if (message.opponentResult?.type === "wrong") {
    els.opponentStateText.textContent = "对手刚答错";
  } else {
    els.opponentStateText.textContent = message.opponentQuestionActive ? "对手正在作答" : "对手等待中";
  }

  const myQuestion = message.currentQuestion ? `${message.currentQuestion.text} = ?` : "等待开始";
  if (message.team === "blue") {
    els.questionBlue.textContent = myQuestion;
    els.questionRed.textContent = opponentSlot ? "对手正在作答" : "等待加入";
    els.myQuestionCardBlue.classList.remove("inactive");
    els.myQuestionCardRed.classList.add("inactive");
  } else {
    els.questionRed.textContent = myQuestion;
    els.questionBlue.textContent = opponentSlot ? "对手正在作答" : "等待加入";
    els.myQuestionCardRed.classList.remove("inactive");
    els.myQuestionCardBlue.classList.add("inactive");
  }

  els.resultBlue.textContent = message.team === "blue" ? renderResult(message.result) : renderResult(message.opponentResult);
  els.resultRed.textContent = message.team === "red" ? renderResult(message.result) : renderResult(message.opponentResult);

  if (message.result?.type && message.result.type !== prevResult) {
    playAudio(message.result.type);
    resetInput();
  }

  if (message.phase === "finished") {
    playAudio("gameover");
    const myWin = message.winner === message.team;
    els.winnerText.textContent = message.winner === "blue" ? "蓝队获胜" : "红队获胜";
    els.summaryText.textContent = myWin
      ? "本局你赢了。关闭弹层后可由房主继续开下一局。"
      : "本局你输了。关闭弹层后可等待房主继续开下一局。";
    els.gameOverlay.classList.remove("hidden");
  } else {
    els.gameOverlay.classList.add("hidden");
  }
}

function handleMessage(message) {
  switch (message.type) {
    case "welcome":
      break;
    case "hello:ok":
      state.sessionId = message.sessionId;
      localStorage.setItem(STORAGE_KEYS.sessionId, state.sessionId);
      localStorage.setItem(STORAGE_KEYS.playerName, message.name);
      setConnectionText(`已连接：${message.name}`, true);
      if (!state.currentRoom && state.currentRoomCodeParam) {
        const joinCode = state.currentRoomCodeParam;
        state.currentRoomCodeParam = "";
        safeSend({ type: "room:join", roomCode: joinCode });
      }
      break;
    case "room:state":
      handleRoomState(message);
      break;
    case "room:left":
      state.currentRoom = null;
      state.myTeam = null;
      resetInput();
      updateLocationRoom("");
      updateRoomShare("");
      showLobby();
      break;
    case "error":
      alert(message.message);
      break;
    default:
      break;
  }
}

function getConfigFromForm() {
  return {
    duration: Number(els.durationSelect.value),
    targetQuestions: Number(els.targetQuestionsInput.value),
    difficulty: els.difficultySelect.value,
    importedQuestions: []
  };
}

function submitAnswer() {
  if (!state.currentInput) {
    return;
  }
  safeSend({ type: "answer:submit", answer: Number(state.currentInput) });
}

function buildNumpad() {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "清空", "提交"];
  els.numpad.innerHTML = "";

  keys.forEach((key) => {
    const button = document.createElement("button");
    button.className = "pad-btn";
    button.textContent = key;
    if (key === "清空") {
      button.classList.add("clear");
    }
    if (key === "提交") {
      button.classList.add("submit");
    }

    button.addEventListener("click", () => {
      if (!state.currentRoom || state.currentRoom.phase !== "playing") {
        return;
      }
      if (key === "清空") {
        resetInput();
        return;
      }
      if (key === "提交") {
        submitAnswer();
        return;
      }
      if (state.currentInput.length >= 6) {
        return;
      }
      state.currentInput += key;
      els.answerDisplay.textContent = state.currentInput;
    });

    els.numpad.appendChild(button);
  });
}

async function copyRoomLink() {
  if (!state.currentRoom?.roomCode) {
    return;
  }
  const link = getFullRoomUrl(state.currentRoom.roomCode);
  try {
    await navigator.clipboard.writeText(link);
    els.roomTipsText.textContent = "邀请链接已复制，可以直接发给对手。";
  } catch (error) {
    els.roomTipsText.textContent = `复制失败，请手动复制：${link}`;
  }
}

els.connectBtn.addEventListener("click", connectSocket);
els.createRoomBtn.addEventListener("click", () => {
  const action = () => safeSend({ type: "room:create", config: getConfigFromForm() });
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    action();
    return;
  }
  setPendingAction(action);
  connectSocket();
});
els.joinRoomBtn.addEventListener("click", () => {
  const roomCode = els.roomCodeInput.value.trim().toUpperCase();
  if (!roomCode) {
    alert("请输入房间号");
    return;
  }
  const action = () => safeSend({ type: "room:join", roomCode });
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    action();
    return;
  }
  setPendingAction(action);
  connectSocket();
});
els.copyRoomLinkBtn.addEventListener("click", copyRoomLink);
els.saveConfigBtn.addEventListener("click", () => {
  safeSend({ type: "room:update-config", config: getConfigFromForm() });
});
els.startGameBtn.addEventListener("click", () => {
  safeSend({ type: "game:start" });
  resetInput();
});
els.leaveRoomBtn.addEventListener("click", () => {
  safeSend({ type: "room:leave" });
});
els.backToLobbyBtn.addEventListener("click", () => {
  els.gameOverlay.classList.add("hidden");
});
els.playerName.addEventListener("change", () => {
  localStorage.setItem(STORAGE_KEYS.playerName, els.playerName.value.trim() || "玩家");
});

window.addEventListener("keydown", (event) => {
  if (!state.currentRoom || state.currentRoom.phase !== "playing") {
    return;
  }
  if (/^[0-9]$/.test(event.key)) {
    if (state.currentInput.length < 6) {
      state.currentInput += event.key;
      els.answerDisplay.textContent = state.currentInput;
    }
  } else if (event.key === "Backspace") {
    state.currentInput = state.currentInput.slice(0, -1);
    els.answerDisplay.textContent = state.currentInput || "-";
  } else if (event.key === "Enter") {
    submitAnswer();
  }
});

fillDifficultyOptions();
buildNumpad();
showLobby();
updateRoomShare("");
if (state.currentRoomCodeParam) {
  connectSocket();
}
