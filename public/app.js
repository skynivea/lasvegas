const socket = io({ transports: ['websocket', 'polling'] });

let currentRoomCode = null;
let myPlayerId = null;
let gameState = null;
let selectedColorKey = 'black';

function selectColor(colorKey, el) {
  selectedColorKey = colorKey;
  document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

function createRoom() {
  const name = document.getElementById('player-name-input').value.trim();
  if (!name) return alert('닉네임을 입력하세요.');
  socket.emit('createRoom', { name, color: selectedColorKey });
}

function joinRoom() {
  const name = document.getElementById('player-name-input').value.trim();
  const roomCode = document.getElementById('room-code-input').value.trim();
  if (!name || !roomCode) return alert('닉네임과 방 코드를 입력하세요.');
  socket.emit('joinRoom', { name, color: selectedColorKey, roomCode });
}

function startGame() {
  if (currentRoomCode) socket.emit('startGame', { roomCode: currentRoomCode });
}

function rollDice() {
  if (currentRoomCode) socket.emit('rollDice', { roomCode: currentRoomCode });
}

function selectDiceToPlace(diceValue) {
  if (currentRoomCode) socket.emit('placeDice', { roomCode: currentRoomCode, diceValue });
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

// 🎲 표준 주사위 눈금 렌더링 HTML 생성 함수
function createDiceFaceHTML(val, colorHex, textColorHex, extraClass = '') {
  let dots = '';
  if (val === 1) dots = '<div class="dice-dot dot-center"></div>';
  else if (val === 2) dots = '<div class="dice-dot dot-tl"></div><div class="dice-dot dot-br"></div>';
  else if (val === 3) dots = '<div class="dice-dot dot-tl"></div><div class="dice-dot dot-center"></div><div class="dice-dot dot-br"></div>';
  else if (val === 4) dots = '<div class="dice-dot dot-tl"></div><div class="dice-dot dot-tr"></div><div class="dice-dot dot-bl"></div><div class="dice-dot dot-br"></div>';
  else if (val === 5) dots = '<div class="dice-dot dot-tl"></div><div class="dice-dot dot-tr"></div><div class="dice-dot dot-center"></div><div class="dice-dot dot-bl"></div><div class="dice-dot dot-br"></div>';
  else if (val === 6) dots = '<div class="dice-dot dot-tl"></div><div class="dice-dot dot-tr"></div><div class="dice-dot dot-ml"></div><div class="dice-dot dot-mr"></div><div class="dice-dot dot-bl"></div><div class="dice-dot dot-br"></div>';

  return `<div class="dice-face ${extraClass}" style="background-color:${colorHex}; color:${textColorHex};">${dots}</div>`;
}

// 소켓 리스너
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

socket.on('errorMsg', msg => alert(msg));

socket.on('chatMessage', (data) => {
  const chatContainer = document.getElementById('chat-messages');
  const div = document.createElement('div');
  if (data.system) {
    div.className = 'chat-item chat-sys';
    div.innerText = `[알림] ${data.text}`;
  } else {
    div.className = 'chat-item';
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
    modalTitle.innerText = "🏆 최종 승리 🏆";
    let bodyHTML = `<h3 style="text-align:center; color:#d4af37; margin-bottom:15px;">우승자: ${data.winner.name} ($${data.winner.totalMoney.toLocaleString()})</h3><ol style="padding-left:20px;">`;
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
        bodyHTML += data.results[c].map(w => `${w.playerName} ($${w.amount.toLocaleString()})`).join(', ');
      } else {
        bodyHTML += `<span style="color:#aaa;">획득자 없음 (폭파)</span>`;
      }
      bodyHTML += `</div>`;
    }
    modalBody.innerHTML = bodyHTML;

    if (gameState && gameState.hostId === myPlayerId) nextBtn.classList.remove('hidden');
    else nextBtn.classList.add('hidden');
  }
});

function renderUI() {
  if (!gameState) return;

  document.getElementById('round-num').innerText = gameState.round;

  const startBtn = document.getElementById('start-btn');
  if (gameState.state === 'WAITING' && gameState.hostId === myPlayerId) startBtn.classList.remove('hidden');
  else startBtn.classList.add('hidden');

  const statusText = document.getElementById('status-text');
  const isMyTurn = gameState.currentTurnPlayerId === myPlayerId;
  if (gameState.state === 'WAITING') {
    statusText.innerText = '플레이어를 기다리는 중...';
  } else if (gameState.state === 'PLAYING') {
    const turnPlayer = gameState.players[gameState.currentTurnIndex];
    statusText.innerText = isMyTurn ? '🔥 당신의 턴입니다!' : `${turnPlayer.name}님 턴 진행 중...`;
  }

  // 1. 플레이어 턴 순서 표시 대시보드
  const playersContainer = document.getElementById('players-list');
  playersContainer.innerHTML = '';
  gameState.players.forEach((p, idx) => {
    const card = document.createElement('div');
    const isTurn = gameState.state === 'PLAYING' && idx === gameState.currentTurnIndex;
    card.className = `player-card ${isTurn ? 'active' : ''}`;
    card.style.borderTopColor = p.color;

    card.innerHTML = `
      <div style="font-weight:bold; font-size:13px; color:${p.color}">
        ${idx + 1}번 턴: ${p.name} ${p.id === gameState.hostId ? '👑' : ''}
      </div>
      <div style="font-size:11px; color:#aaa; margin-top:3px;">주사위: <b>${p.diceCount}개</b></div>
      <div style="font-size:11px; color:#aaa;">소지금: <b>$${p.totalMoney.toLocaleString()}</b></div>
    `;
    playersContainer.appendChild(card);
  });

  // 2. 마름모 카지노 6개 렌더링
  const casinosContainer = document.getElementById('casinos-container');
  casinosContainer.innerHTML = '';

  for (let c = 1; c <= 6; c++) {
    const casinoData = gameState.casinos[c] || { bills: [], dicePlaced: {} };
    const wrapper = document.createElement('div');
    wrapper.className = 'casino-diamond-wrapper';

    let billsHTML = casinoData.bills.map(b => `<div class="real-bill">$${b/1000}K</div>`).join('');

    let diceHTML = '';
    Object.keys(casinoData.dicePlaced).forEach(pId => {
      const count = casinoData.dicePlaced[pId];
      const player = gameState.players.find(p => p.id === pId);
      if (player && count > 0) {
        for (let i = 0; i < count; i++) {
          diceHTML += createDiceFaceHTML(c, player.color, player.textColor);
        }
      }
    });

    wrapper.innerHTML = `
      <div class="casino-diamond"></div>
      <div class="casino-content">
        <div class="casino-num">${c}</div>
        <div class="bills-container">${billsHTML}</div>
        <div class="placed-dice-area">${diceHTML}</div>
      </div>
    `;

    casinosContainer.appendChild(wrapper);
  }

  // 3. 하단 주사위 컨트롤 및 오름차순 자동 정렬
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

      // 눈금별 그룹화 및 오름차순 배치
      const counts = {};
      myPlayer.currentRoll.forEach(v => counts[v] = (counts[v] || 0) + 1);

      Object.keys(counts).forEach(valStr => {
        const val = parseInt(valStr);
        const group = document.createElement('div');
        group.style.display = 'flex';
        group.style.alignItems = 'center';
        group.style.gap = '4px';
        group.style.cursor = 'pointer';
        group.onclick = () => selectDiceToPlace(val);

        for (let i = 0; i < counts[val]; i++) {
          group.innerHTML += createDiceFaceHTML(val, myPlayer.color, myPlayer.textColor, 'rolling');
        }

        diceArea.appendChild(group);
      });
    }
  } else {
    rollBtn.disabled = true;
    rollBtn.style.opacity = '0.4';
  }
}
