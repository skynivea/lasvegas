const socket = io({ transports: ['websocket', 'polling'] });

let currentRoomCode = null;
let myPlayerId = null;
let gameState = null;
let isRollingAnimation = false;

function createRoom() {
  const name = document.getElementById('player-name-input').value.trim();
  if (!name) return alert('닉네임을 입력하세요.');
  socket.emit('createRoom', { name });
}

function joinRoom() {
  const name = document.getElementById('player-name-input').value.trim();
  const roomCode = document.getElementById('room-code-input').value.trim();
  if (!name || !roomCode) return alert('닉네임과 방 코드를 입력하세요.');
  socket.emit('joinRoom', { name, roomCode });
}

function pickColor(colorKey) {
  if (currentRoomCode) socket.emit('pickColor', { roomCode: currentRoomCode, colorKey });
}

function startGame() {
  if (currentRoomCode) socket.emit('startGame', { roomCode: currentRoomCode });
}

// 주사위 굴리기 연출 실행 함수
function handleRollDiceClick() {
  if (!currentRoomCode || isRollingAnimation) return;
  
  const myPlayer = gameState.players.find(p => p.id === myPlayerId);
  if (!myPlayer || myPlayer.diceCount <= 0) return;

  isRollingAnimation = true;
  const diceArea = document.getElementById('rolled-dice-area');
  diceArea.innerHTML = '';

  // 1단계: 남아있는 주사위 개수만큼 3D 회전 애니메이션 셋팅
  for (let i = 0; i < myPlayer.diceCount; i++) {
    const randomTempVal = Math.floor(Math.random() * 6) + 1;
    const diceHTML = createDiceFaceHTML(randomTempVal, myPlayer.color, myPlayer.textColor, 'anim-drop anim-spin');
    const wrapper = document.createElement('div');
    wrapper.className = 'dice-3d-box';
    wrapper.innerHTML = diceHTML;
    diceArea.appendChild(wrapper);
  }

  // 회전음 스핀 동안 무작위로 눈 바꾸는 시각 효과
  const spinInterval = setInterval(() => {
    const diceElements = diceArea.querySelectorAll('.dice-face');
    diceElements.forEach(el => {
      const randVal = Math.floor(Math.random() * 6) + 1;
      el.replaceWith(document.createElement('div'));
    });
  }, 100);

  // 2단계: 0.8초 후 서버로 굴림 요청 보냄
  setTimeout(() => {
    clearInterval(spinInterval);
    socket.emit('rollDice', { roomCode: currentRoomCode });
  }, 800);
}

function selectDiceToPlace(diceValue) {
  if (currentRoomCode && !isRollingAnimation) {
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

socket.on('errorMsg', msg => {
  isRollingAnimation = false;
  alert(msg);
});

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
    let bodyHTML = `<h3 style="text-align:center; color:#ffd700; margin-bottom:15px;">우승자: ${data.winner.name} ($${data.winner.totalMoney.toLocaleString()})</h3><ol style="padding-left:20px;">`;
    const sorted = [...data.players].sort((a,b) => b.totalMoney - a.totalMoney);
    sorted.forEach(p => {
      bodyHTML += `<li><b>${p.name}</b>: $${p.totalMoney.toLocaleString()} (${p.cardsWon}장)</li>`;
    });
    bodyHTML += `</ol>`;
    modalBody.innerHTML = bodyHTML;
    nextBtn.classList.add('hidden');
  } else {
    modalTitle.innerText = `ROUND ${data.round} 정산`;
    let bodyHTML = '';
    for (let c = 1; c <= 6; c++) {
      bodyHTML += `<div style="margin-bottom:8px;"><b>[카지노 ${c}]</b> `;
      if (data.results[c] && data.results[c].length > 0) {
        bodyHTML += data.results[c].map(w => `${w.playerName} ($${w.amount.toLocaleString()})`).join(', ');
      } else {
        bodyHTML += `<span style="color:#888;">획득자 없음 (폭파)</span>`;
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

  // 1. 색상 선택 패널
  const colorPanel = document.getElementById('color-select-panel');
  const colorBtnsContainer = document.getElementById('color-buttons-container');

  if (gameState.state === 'COLOR_SELECTION') {
    colorPanel.classList.remove('hidden');
    colorBtnsContainer.innerHTML = '';

    const COLOR_MAP = {
      black: { code: '#212529', name: '검정', text: '#FFFFFF' },
      white: { code: '#F8F9FA', name: '하양', text: '#212529' },
      red: { code: '#E63946', name: '빨강', text: '#FFFFFF' },
      blue: { code: '#1D3557', name: '파랑', text: '#FFFFFF' }
    };

    Object.keys(gameState.colorSelectionMap).forEach(key => {
      const data = gameState.colorSelectionMap[key];
      const colorObj = COLOR_MAP[key];

      const btn = document.createElement('button');
      btn.className = `color-btn ${data.selectedBy ? 'selected' : ''}`;
      btn.style.backgroundColor = colorObj.code;
      btn.style.color = colorObj.text;

      if (data.selectedBy) {
        btn.innerText = `${colorObj.name}\n(${data.selectedBy}: ${data.orderNum}번 턴)`;
      } else {
        btn.innerText = `${colorObj.name}\n[선택]`;
        btn.onclick = () => pickColor(key);
      }
      colorBtnsContainer.appendChild(btn);
    });
  } else {
    colorPanel.classList.add('hidden');
  }

  // 2. 방장 시작 버튼 노출
  const startBtn = document.getElementById('start-btn');
  if (gameState.state === 'WAITING' && gameState.hostId === myPlayerId) startBtn.classList.remove('hidden');
  else startBtn.classList.add('hidden');

  // 3. 턴 상태 안내 텍스트
  const statusText = document.getElementById('status-text');
  const isMyTurn = gameState.currentTurnPlayerId === myPlayerId;
  
  if (gameState.state === 'WAITING') {
    statusText.innerText = '대기실 - 인원이 모이면 방장이 게임 시작 버튼을 누르세요.';
  } else if (gameState.state === 'COLOR_SELECTION') {
    statusText.innerText = '원하는 색상을 뽑아 턴 순서를 정해 보세요!';
  } else if (gameState.state === 'PLAYING') {
    const turnPlayer = gameState.players[gameState.currentTurnIndex];
    statusText.innerText = isMyTurn ? '🔥 당신의 턴입니다!' : `${turnPlayer.name}님 턴 진행 중...`;
  }

  // 4. 플레이어 프로필 바
  const playersContainer = document.getElementById('players-list');
  playersContainer.innerHTML = '';
  gameState.players.forEach((p, idx) => {
    const card = document.createElement('div');
    const isTurn = gameState.state === 'PLAYING' && idx === gameState.currentTurnIndex;
    
    card.className = `player-card ${isTurn ? 'active' : ''}`;
    card.style.borderTopColor = p.color;

    if (gameState.state === 'PLAYING' && p.diceCount === 0) {
      card.style.opacity = '0.4';
    } else {
      card.style.opacity = '1';
    }

    card.innerHTML = `
      <div style="font-weight:900; font-size:13px; color:${p.color}">
        ${p.turnOrder ? `${p.turnOrder}번: ` : ''}${p.name} ${p.id === gameState.hostId ? '👑' : ''}
      </div>
      <div style="font-size:12px; margin-top:5px; color:#ddd;">
        🎲 남은 주사위: <b style="color:#ffd700; font-size:14px;">${p.diceCount}개</b>
      </div>
      <div style="font-size:11px; color:#aaa; margin-top:2px;">
        💵 총 소지금: <b>$${p.totalMoney.toLocaleString()}</b>
      </div>
    `;
    playersContainer.appendChild(card);
  });

  // 5. 카지노 1~6 번 보드 타일 렌더링 (원작 다이아몬드 타일 형태)
  const casinosContainer = document.getElementById('casinos-container');
  casinosContainer.innerHTML = '';

  for (let c = 1; c <= 6; c++) {
    const casinoData = gameState.casinos[c] || { bills: [], dicePlaced: {} };
    const tile = document.createElement('div');
    tile.className = 'casino-tile';

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

    tile.innerHTML = `
      <div class="casino-badge top-right">${c}</div>
      <div class="casino-badge bottom-left">${c}</div>
      <div class="bills-container">${billsHTML}</div>
      <div class="placed-dice-area">${diceHTML}</div>
    `;

    casinosContainer.appendChild(tile);
  }

  // 6. 주사위 굴린 후 1~6 정렬 배치 영역
  const rollBtn = document.getElementById('roll-btn');
  const diceArea = document.getElementById('rolled-dice-area');
  const myPlayer = gameState.players.find(p => p.id === myPlayerId);

  if (gameState.state === 'PLAYING' && isMyTurn && myPlayer) {
    if (myPlayer.currentRoll.length === 0) {
      rollBtn.disabled = false;
      rollBtn.style.opacity = '1';
      if (!isRollingAnimation) diceArea.innerHTML = '';
    } else {
      // 굴림 완료 후: 애니메이션 종료 후 오름차순(1~6) 정렬하여 표시
      isRollingAnimation = false;
      rollBtn.disabled = true;
      rollBtn.style.opacity = '0.4';

      diceArea.innerHTML = '';

      // 눈별로 주사위 개수 그룹핑
      const counts = {};
      myPlayer.currentRoll.forEach(v => counts[v] = (counts[v] || 0) + 1);

      // 1부터 6까지 순서대로 정렬하여 그룹 노출
      Object.keys(counts).sort((a,b) => parseInt(a) - parseInt(b)).forEach(valStr => {
        const val = parseInt(valStr);
        const group = document.createElement('div');
        group.className = 'dice-group';
        group.title = `${val}번 카지노에 주사위 ${counts[val]}개 배치하기`;
        group.onclick = () => selectDiceToPlace(val);

        for (let i = 0; i < counts[val]; i++) {
          group.innerHTML += createDiceFaceHTML(val, myPlayer.color, myPlayer.textColor, 'anim-drop');
        }

        diceArea.appendChild(group);
      });
    }
  } else {
    rollBtn.disabled = true;
    rollBtn.style.opacity = '0.4';
    if (!isRollingAnimation) diceArea.innerHTML = '';
  }
}
