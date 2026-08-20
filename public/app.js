const socket = io({
  transports: ['websocket', 'polling']
});

let currentRoomCode = null;
let myPlayerId = null;
let gameState = null;

// 로비 이벤트
function createRoom() {
  const name = document.getElementById('player-name-input').value.trim();
  if (!name) return alert('닉네임을 입력해 주세요.');
  socket.emit('createRoom', { name });
}

function joinRoom() {
  const name = document.getElementById('player-name-input').value.trim();
  const roomCode = document.getElementById('room-code-input').value.trim();
  if (!name || !roomCode) return alert('닉네임과 방 코드를 모두 입력해 주세요.');
  socket.emit('joinRoom', { name, roomCode });
}

function startGame() {
  if (currentRoomCode) {
    socket.emit('startGame', { roomCode: currentRoomCode });
  }
}

function rollDice() {
  if (currentRoomCode) {
    socket.emit('rollDice', { roomCode: currentRoomCode });
  }
}

function selectDiceToPlace(diceValue) {
  if (currentRoomCode) {
    socket.emit('placeDice', { roomCode: currentRoomCode, diceValue });
  }
}

function nextRound() {
  if (currentRoomCode) {
    socket.emit('nextRound', { roomCode: currentRoomCode });
    document.getElementById('result-modal').classList.add('hidden');
  }
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (text && currentRoomCode) {
    socket.emit('sendChat', { roomCode: currentRoomCode, message: text });
    input.value = '';
  }
}

// 수신 소켓 이벤트 처리
socket.on('roomCreated', ({ roomCode, playerId }) => {
  currentRoomCode = roomCode;
  myPlayerId = playerId;
  document.getElementById('lobby-overlay').classList.add('hidden');
  document.getElementById('display-room-code').innerText = roomCode;
});

socket.on('roomJoined', ({ roomCode, playerId }) => {
  currentRoomCode = roomCode;
  myPlayerId = playerId;
  document.getElementById('lobby-overlay').classList.add('hidden');
  document.getElementById('display-room-code').innerText = roomCode;
});

socket.on('errorMsg', (msg) => {
  alert(msg);
});

socket.on('chatMessage', (data) => {
  const chatContainer = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-item';
  if (data.system) {
    div.className = 'chat-item chat-sys';
    div.innerText = `[시스템] ${data.text}`;
  } else {
    div.innerHTML = `<b style="color:${data.color}">${data.sender}:</b> ${data.text}`;
  }
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
});

socket.on('gameStateUpdate', (state) => {
  gameState = state;
  renderUI();
});

socket.on('roundResolved', (data) => {
  const modal = document.getElementById('result-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const nextBtn = document.getElementById('next-round-btn');

  modal.classList.remove('hidden');

  if (data.isGameOver) {
    modalTitle.innerText = "🏆 최종 게임 종료 🏆";
    let bodyHTML = `<h3 style="text-align:center; color:#85bb65; margin-bottom:15px;">우승자: ${data.winner.name} ($${data.winner.totalMoney.toLocaleString()})</h3>`;
    bodyHTML += `<hr style="border-color:#2a5a44; margin:10px 0;"><ol style="padding-left:20px;">`;
    
    // 순위 정렬
    const sorted = [...data.players].sort((a,b) => b.totalMoney - a.totalMoney);
    sorted.forEach(p => {
      bodyHTML += `<li><b>${p.name}</b>: $${p.totalMoney.toLocaleString()} (${p.cardsWon}장)</li>`;
    });
    bodyHTML += `</ol>`;
    modalBody.innerHTML = bodyHTML;
    nextBtn.classList.add('hidden');
  } else {
    modalTitle.innerText = `라운드 ${data.round} 결과 정산`;
    let bodyHTML = '';
    for (let c = 1; c <= 6; c++) {
      bodyHTML += `<div style="margin-bottom:8px;"><b>[카지노 ${c}]</b> `;
      if (data.results[c] && data.results[c].length > 0) {
        const wins = data.results[c].map(w => `${w.playerName} ($${w.amount.toLocaleString()})`).join(', ');
        bodyHTML += wins;
      } else {
        bodyHTML += `<span style="color:#aaa;">획득자 없음 (폭파 또는 돈 없음)</span>`;
      }
      bodyHTML += `</div>`;
    }
    modalBody.innerHTML = bodyHTML;

    // 방장에게만 다음 라운드 버튼 노출
    if (gameState && gameState.hostId === myPlayerId) {
      nextBtn.classList.remove('hidden');
    } else {
      nextBtn.classList.add('hidden');
    }
  }
});

// 화면 UI 렌더링
function renderUI() {
  if (!gameState) return;

  document.getElementById('round-num').innerText = gameState.round;

  // 방장 시작 버튼 처리
  const startBtn = document.getElementById('start-btn');
  if (gameState.state === 'WAITING' && gameState.hostId === myPlayerId) {
    startBtn.classList.remove('hidden');
  } else {
    startBtn.classList.add('hidden');
  }

  // 상태 텍스트
  const statusText = document.getElementById('status-text');
  const isMyTurn = gameState.currentTurnPlayerId === myPlayerId;
  if (gameState.state === 'WAITING') {
    statusText.innerText = '인원을 기다리는 중입니다...';
  } else if (gameState.state === 'PLAYING') {
    const turnPlayer = gameState.players[gameState.currentTurnIndex];
    statusText.innerText = isMyTurn ? '🔥 당신의 턴입니다!' : `${turnPlayer.name}님의 턴 진행 중...`;
  }

  // 1. 플레이어 목록 렌더링
  const playersContainer = document.getElementById('players-list');
  playersContainer.innerHTML = '';
  gameState.players.forEach((p, idx) => {
    const card = document.createElement('div');
    const isTurn = gameState.state === 'PLAYING' && idx === gameState.currentTurnIndex;
    card.className = `player-card ${isTurn ? 'active' : ''}`;
    card.style.borderColor = p.color;

    card.innerHTML = `
      <div class="player-name" style="color:${p.color}">
        ${p.name} ${p.id === gameState.hostId ? '👑' : ''}
      </div>
      <div class="player-stats">남은 주사위: <b>${p.diceCount}개</b></div>
      <div class="player-stats">획득 금액: <b>$${p.totalMoney.toLocaleString()}</b></div>
    `;
    playersContainer.appendChild(card);
  });

  // 2. 카지노 6개 렌더링
  const casinosContainer = document.getElementById('casinos-container');
  casinosContainer.innerHTML = '';

  for (let c = 1; c <= 6; c++) {
    const casinoData = gameState.casinos[c] || { bills: [], dicePlaced: {} };
    const card = document.createElement('div');
    card.className = 'casino-card';

    let billsHTML = casinoData.bills.map(b => `<span class="bill-tag">$${b/1000}k</span>`).join('');
    
    // 배치된 주사위 HTML
    let diceHTML = '';
    Object.keys(casinoData.dicePlaced).forEach(pId => {
      const count = casinoData.dicePlaced[pId];
      const player = gameState.players.find(p => p.id === pId);
      if (player && count > 0) {
        for (let i = 0; i < count; i++) {
          diceHTML += `<div class="placed-dice" style="background:${player.color}">${c}</div>`;
        }
      }
    });

    card.innerHTML = `
      <div class="casino-header">
        <span class="casino-num">${c}</span>
        <div class="money-bills">${billsHTML}</div>
      </div>
      <div style="margin: 10px 0;">
        <span style="font-size:11px; color:#aaa;">배치된 주사위:</span>
        <div class="dice-slots" style="margin-top:4px;">${diceHTML}</div>
      </div>
    `;

    casinosContainer.appendChild(card);
  }

  // 3. 하단 컨트롤러 렌더링 (내 턴일 때만 액션 활성화)
  const rollBtn = document.getElementById('roll-btn');
  const diceArea = document.getElementById('rolled-dice-area');
  diceArea.innerHTML = '';

  const myPlayer = gameState.players.find(p => p.id === myPlayerId);

  if (gameState.state === 'PLAYING' && isMyTurn && myPlayer) {
    if (myPlayer.currentRoll.length === 0) {
      rollBtn.disabled = false;
      rollBtn.style.opacity = '1';
    } else {
      rollBtn.disabled = true;
      rollBtn.style.opacity = '0.4';

      // 굴린 주사위 선택 버튼 생성
      const counts = {};
      myPlayer.currentRoll.forEach(v => counts[v] = (counts[v] || 0) + 1);

      Object.keys(counts).forEach(val => {
        const btn = document.createElement('div');
        btn.className = 'die-btn';
        btn.innerText = `${val} (${counts[val]}개)`;
        btn.onclick = () => selectDiceToPlace(parseInt(val));
        diceArea.appendChild(btn);
      });
    }
  } else {
    rollBtn.disabled = true;
    rollBtn.style.opacity = '0.4';
  }
}
