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

const state = {
  socket: null,
  connected: false,
  currentRoom: null,
  currentInput: "",
  myTeam: null,
  clientName: "玩家",
  pendingAction: null
};

const els = {
  playerName: document.getElementById("playerName"),
  connectBtn: document.getElementById("connectBtn"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  connectionText: document.getElementById("connectionText"),
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
  blueScore: document.getElementById("blueScore"),
  redScore: document.getElementById("redScore"),
  blueProgressText: document.getElementById("blueProgressText"),
  redProgressText: document.getElementById("redProgressText"),
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

  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}`);
  state.socket = socket;
  setConnectionText("连接中...", false);

  socket.addEventListener("open", () => {
    state.connected = true;
    state.clientName = els.playerName.value.trim() || "玩家";
    setConnectionText("已连接", true);
    safeSend({ type: "hello", name: state.clientName });
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
    state.currentRoom = null;
    setConnectionText("连接已断开", false);
    showLobby();
  });
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function renderResult(result) {
  if (!result) {
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
  els.gameOverlay.classList.add("hidden");
}

function showGame() {
  els.panelLobby.style.display = "none";
  els.panelGame.style.display = "block";
}

function resetInput() {
  state.currentInput = "";
  els.answerDisplay.textContent = "-";
}

function handleRoomState(message) {
  const prev = state.currentRoom;
  const prevResult = prev ? prev.result?.type : null;
  state.currentRoom = message;
  state.myTeam = message.team;

  els.roomCodeText.textContent = message.roomCode;
  els.teamText.textContent = message.team === "blue" ? "蓝队" : "红队";
  els.phaseText.textContent = message.phase;
  els.bluePlayerText.textContent = message.players.blue || "空位";
  els.redPlayerText.textContent = message.players.red || "空位";

  els.durationSelect.value = String(message.config.duration);
  els.targetQuestionsInput.value = String(message.config.targetQuestions);
  els.difficultySelect.value = message.config.difficulty;

  const editable = message.isHost && message.phase === "lobby";
  [els.durationSelect, els.targetQuestionsInput, els.difficultySelect, els.saveConfigBtn, els.startGameBtn]
    .forEach((el) => { el.disabled = !editable; });

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
  els.ropeHint.textContent = message.phase === "playing" ? "服务端实时结算中" : "等待比赛开始";
  els.meTeamLabel.textContent = message.team === "blue" ? "你是蓝队" : "你是红队";
  els.opponentStateText.textContent = message.opponentResult?.type === "correct"
    ? "对手刚答对"
    : message.opponentResult?.type === "wrong"
      ? "对手刚答错"
      : message.opponentQuestionActive ? "对手正在作答" : "对手等待中";

  const myQuestion = message.currentQuestion ? `${message.currentQuestion.text} = ?` : "等待开始";
  if (message.team === "blue") {
    els.questionBlue.textContent = myQuestion;
    els.questionRed.textContent = "对手作答中";
    els.myQuestionCardBlue.classList.remove("inactive");
    els.myQuestionCardRed.classList.add("inactive");
  } else {
    els.questionRed.textContent = myQuestion;
    els.questionBlue.textContent = "对手作答中";
    els.myQuestionCardRed.classList.remove("inactive");
    els.myQuestionCardBlue.classList.add("inactive");
  }

  els.resultBlue.textContent = message.team === "blue" ? renderResult(message.result) : renderResult(message.opponentResult);
  els.resultRed.textContent = message.team === "red" ? renderResult(message.result) : renderResult(message.opponentResult);

  if (message.result?.type && message.result.type !== prevResult) {
    playAudio(message.result.type);
    if (message.result.type === "correct") {
      resetInput();
    }
  }

  if (message.phase === "finished") {
    playAudio("gameover");
    const myWin = message.winner === message.team;
    els.winnerText.textContent = message.winner === "blue" ? "蓝队获胜" : "红队获胜";
    els.summaryText.textContent = myWin ? "本局你赢了。返回大厅后可重新开局。" : "本局你输了。返回大厅后可重新开局。";
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
      setConnectionText(`已连接：${message.name}`, true);
      break;
    case "room:state":
      handleRoomState(message);
      break;
    case "room:left":
      state.currentRoom = null;
      state.myTeam = null;
      resetInput();
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
  if (safeSend({ type: "answer:submit", answer: Number(state.currentInput) })) {
    if (state.currentRoom && state.currentRoom.phase !== "playing") {
      resetInput();
    }
  }
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

els.connectBtn.addEventListener("click", connectSocket);
els.createRoomBtn.addEventListener("click", () => {
  const action = () => safeSend({ type: "room:create", config: getConfigFromForm() });
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    action();
    return;
  }
  state.pendingAction = action;
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
  state.pendingAction = action;
  connectSocket();
});
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
  showLobby();
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
