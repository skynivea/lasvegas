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

const CUBE_ROTATIONS = {
  1: { x: 0,    y: 0 },
  6: { x: 0,    y: 180 },
  2: { x: 0,    y: -90 },
  5: { x: 0,    y: 90 },
  3: { x: -90,  y: 0 },
  4: { x: 90,   y: 0 }
};

// 🎲 주사위 굴리기 핸들러 (버튼 동작 보장)
function handleRollDiceClick() {
  if (!currentRoomCode || isRollingAnimation) return;

  const myPlayer = gameState?.players.find(p => p.id === myPlayerId);
  if (!myPlayer || myPlayer.diceCount <= 0) return;

  isRollingAnimation = true;
  const rollBtn = document.getElementById('roll-btn');
  rollBtn.disabled = true;

  const diceArea = document.getElementById('rolled-dice-area');
  diceArea.innerHTML = '';

  const count = myPlayer.diceCount;
  const cubes = [];

  for (let i = 0; i < count; i++) {
    const container = document.createElement('div');
    container.className = 'cube-container anim-physics-drop';
    container.style.animationDelay = `${i * 0.05}s`;

    const cube = document.createElement('div');
    cube.className = 'cube-3d';

    for (let face = 1; face <= 6; face++) {
      const faceEl = document.createElement('div');
      faceEl.className = `cube-face face-${face}`;
      faceEl.style.backgroundColor = myPlayer.color;
      faceEl.style.color = myPlayer.textColor;
      faceEl.innerHTML = getDotsHTML(face);
      cube.appendChild(faceEl);
    }

    container.appendChild(cube);
    diceArea.appendChild(container);
    cubes.push(cube);
  }

  // 3D 회전 효과
  cubes.forEach((cube) => {
    const randomRotX = (Math.floor(Math.random() * 4) + 4) * 360;
    const randomRotY = (Math.floor(Math.random() * 4) + 4) * 360;
    cube.style.transform = `rotateX(${randomRotX}deg) rotateY(${randomRotY}deg)`;
  });

  // 서버 통신
  setTimeout(() => {
    socket.emit('rollDice', { roomCode: currentRoomCode });
  }, 350);
}

function animateCubesToFinalAndSort(results, player) {
  const diceArea = document.getElementById('rolled-dice-area');
  const cubes = diceArea.querySelectorAll('.cube-3d');

  if (cubes.length === 0) {
    isRollingAnimation = false;
    renderUI();
    return;
  }

  cubes.forEach((cube, idx) => {
    const finalVal = results[idx] || 1;
    const rot = CUBE_ROTATIONS[finalVal];
    cube.style.transform = `rotateX(${1440 + rot.x}deg) rotateY(${1440 + rot.y}deg)`;
  });

  setTimeout(() => {
    diceArea.innerHTML = '';
    const counts = {};
    results.forEach(v => counts[v] = (counts[v] || 0) + 1);

    Object.keys(counts).sort((a,b) => parseInt(a) - parseInt(b)).forEach(valStr => {
      const val = parseInt(valStr);
      const group = document.createElement('div');
      group.className = 'dice-group';
      group.title = `${val}번 카지노에 배치`;
      group.onclick = () => selectDiceToPlace(val);

      for (let i = 0; i < counts[val]; i++) {
        const miniCubeContainer = document.createElement('div');
        miniCubeContainer.className = 'cube-container';
        miniCubeContainer.style.transform = 'scale(0.85)';

        const miniCube = document.createElement('div');
        miniCube.className = 'cube-3d';

        for (let face = 1; face <= 6; face++) {
          const faceEl = document.createElement('div');
          faceEl.className = `cube-face face-${face}`;
          faceEl.style.backgroundColor = player.color;
          faceEl.style.color = player.textColor;
          faceEl.innerHTML = getDotsHTML(face);
          miniCube.appendChild(faceEl);
        }

        const rot = CUBE_ROTATIONS[val];
        miniCube.style.transform = `rotateX(${rot.x}deg) rotateY(${rot.y}deg)`;
        miniCubeContainer.appendChild(miniCube);
        group.appendChild(miniCubeContainer);
      }

      diceArea.appendChild(group);
    });

    isRollingAnimation = false;
  }, 900);
}

// 카지노에 주사위 배치 핸들러 (클릭 즉시 내 덱에서 주사위 제거)
function selectDiceToPlace(diceValue) {
  if (!currentRoomCode || isRollingAnimation) return;

  const myPlayer = gameState?.players.find(p => p.id === myPlayerId);
  if (!myPlayer || myPlayer.currentRoll.length === 0) return;

  // 1. 중복 클릭 방지 플래그 설정
  isRollingAnimation = true;

  // 2. [핵심] 내 덱 화면에서 주사위 즉시 제거 (복제 현상 해결)
  const diceArea = document.getElementById('rolled-dice-area');
  if (diceArea) {
    diceArea.innerHTML = '<span style="font-size: 12px; color: #ffd700;">주사위 배치 중...</span>';
  }

  // 3. 서버로 주사위 배치 요청
  socket.emit('placeDice', { roomCode: currentRoomCode, diceValue });
}

// 주사위 굴림 결과 정렬 및 생성 부분
function animateCubesToFinalAndSort(results, player) {
  const diceArea = document.getElementById('rolled-dice-area');
  const cubes = diceArea.querySelectorAll('.cube-3d');

  if (cubes.length === 0) {
    isRollingAnimation = false;
    renderUI();
    return;
  }

  cubes.forEach((cube, idx) => {
    const finalVal = results[idx] || 1;
    const rot = CUBE_ROTATIONS[finalVal];
    cube.style.transform = `rotateX(${1440 + rot.x}deg) rotateY(${1440 + rot.y}deg)`;
  });

  setTimeout(() => {
    diceArea.innerHTML = '';
    const counts = {};
    results.forEach(v => counts[v] = (counts[v] || 0) + 1);

    Object.keys(counts).sort((a,b) => parseInt(a) - parseInt(b)).forEach(valStr => {
      const val = parseInt(valStr);
      const group = document.createElement('div');
      group.className = 'dice-group';
      group.title = `${val}번 카지노에 배치`;
      
      // 클릭 시 해당 그룹 주사위 배치 및 내 덱에서 즉시 삭제
      group.onclick = () => selectDiceToPlace(val);

      for (let i = 0; i < counts[val]; i++) {
        const miniCubeContainer = document.createElement('div');
        miniCubeContainer.className = 'cube-container';
        miniCubeContainer.style.transform = 'scale(0.85)';

        const miniCube = document.createElement('div');
        miniCube.className = 'cube-3d';

        for (let face = 1; face <= 6; face++) {
          const faceEl = document.createElement('div');
          faceEl.className = `cube-face face-${face}`;
          faceEl.style.backgroundColor = player.color;
          faceEl.style.color = player.textColor;
          faceEl.innerHTML = getDotsHTML(face);
          miniCube.appendChild(faceEl);
        }

        const rot = CUBE_ROTATIONS[val];
        miniCube.style.transform = `rotateX(${rot.x}deg) rotateY(${rot.y}deg)`;
        miniCubeContainer.appendChild(miniCube);
        group.appendChild(miniCubeContainer);
      }

      diceArea.appendChild(group);
    });

    // 주사위 선택 대기 상태 진입
    isRollingAnimation = false;
  }, 900);
}

// UI 렌더링 시 주사위 덱 상태 보완
function renderUI() {
  if (!gameState || isRollingAnimation) return;

  // ... 기존 renderUI 상단 로직 동일 ...

  const rollBtn = document.getElementById('roll-btn');
  const diceArea = document.getElementById('rolled-dice-area');
  const myPlayer = gameState.players.find(p => p.id === myPlayerId);

  // 내 턴이고, 굴린 주사위도 없고, 남은 주사위도 없는 상태(배치 완료 후)라면 덱 비우기
  if (myPlayer && myPlayer.currentRoll.length === 0 && !isRollingAnimation) {
    if (diceArea && !diceArea.querySelector('.cube-container')) {
      diceArea.innerHTML = '';
    }
  }

  // 주사위 굴리기 버튼 활성화 로직
  if (gameState.state === 'PLAYING' && isMyTurn && myPlayer && myPlayer.diceCount > 0 && myPlayer.currentRoll.length === 0) {
    rollBtn.disabled = false;
    rollBtn.style.opacity = '1';
    rollBtn.style.cursor = 'pointer';
  } else {
    rollBtn.disabled = true;
    rollBtn.style.opacity = '0.4';
    rollBtn.style.cursor = 'not-allowed';
  }
}
// 💵 지폐 더미에서 1번~6번 카지노 순차 딜링 연출
function runMoneyDealingSequence() {
  renderUI(); // 화면 갱신 후

  const allBills = document.querySelectorAll('.real-bill');
  allBills.forEach((bill, idx) => {
    bill.style.opacity = '0';
    bill.classList.remove('anim-fly-deal');

    // 1번 카지노부터 차례대로 착-착 날아오는 시간차 부여
    setTimeout(() => {
      bill.style.opacity = '1';
      bill.classList.add('anim-fly-deal');
    }, idx * 120);
  });
}

function confirmResult() {
  if (currentRoomCode) {
    socket.emit('confirmResult', { roomCode: currentRoomCode });
    const btn = document.getElementById('confirm-btn');
    btn.disabled = true;
    btn.innerText = "다른 플레이어 대기 중...";
  }
}

function nextRound() {
  if (currentRoomCode) {
    socket.emit('nextRound', { roomCode: currentRoomCode });
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

function getDotsHTML(val) {
  if (val === 1) return '<div class="dice-dot dot-center"></div>';
  if (val === 2) return '<div class="dice-dot dot-tl"></div><div class="dice-dot dot-br"></div>';
  if (val === 3) return '<div class="dice-dot dot-tl"></div><div class="dice-dot dot-center"></div><div class="dice-dot dot-br"></div>';
  if (val === 4) return '<div class="dice-dot dot-tl"></div><div class="dice-dot dot-tr"></div><div class="dice-dot dot-bl"></div><div class="dice-dot dot-br"></div>';
  if (val === 5) return '<div class="dice-dot dot-tl"></div><div class="dice-dot dot-tr"></div><div class="dice-dot dot-center"></div><div class="dice-dot dot-bl"></div><div class="dice-dot dot-br"></div>';
  if (val === 6) return '<div class="dice-dot dot-tl"></div><div class="dice-dot dot-tr"></div><div class="dice-dot dot-ml"></div><div class="dice-dot dot-mr"></div><div class="dice-dot dot-bl"></div><div class="dice-dot dot-br"></div>';
  return '';
}

function create2DDiceHTML(val, colorHex, textColorHex) {
  return `<div class="dice-face-2d" style="background-color:${colorHex}; color:${textColorHex};">${getDotsHTML(val)}</div>`;
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

socket.on('errorMsg', msg => {
  isRollingAnimation = false;
  alert(msg);
});

socket.on('closeModal', () => {
  document.getElementById('result-modal').classList.add('hidden');
  const btn = document.getElementById('confirm-btn');
  btn.disabled = false;
  btn.innerText = "확인 완료";
});

socket.on('startMoneyDealingSequence', () => {
  runMoneyDealingSequence();
});

socket.on('gameStateUpdate', (state) => {
  const oldRoll = gameState?.players.find(p => p.id === myPlayerId)?.currentRoll || [];
  gameState = state;

  const myPlayer = gameState.players.find(p => p.id === myPlayerId);

  // 애니메이션 중 굴림 결과 도착 시
  if (isRollingAnimation && myPlayer && myPlayer.currentRoll.length > 0 && oldRoll.length === 0) {
    animateCubesToFinalAndSort(myPlayer.currentRoll, myPlayer);
  } else {
    // 턴 교체 시 애니메이션 플래그 복구 안전장치
    if (gameState.currentTurnPlayerId === myPlayerId && myPlayer && myPlayer.currentRoll.length === 0) {
      isRollingAnimation = false;
    }
    renderUI();
  }
});

socket.on('roundResolved', (data) => {
  const modal = document.getElementById('result-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const confirmBtn = document.getElementById('confirm-btn');
  const nextBtn = document.getElementById('next-round-btn');

  modal.classList.remove('hidden');
  confirmBtn.disabled = false;
  confirmBtn.innerText = "확인 완료";

  if (data.isGameOver) {
    modalTitle.innerText = "🏆 최종 승리 🏆";
    let bodyHTML = `<h3 style="text-align:center; color:#ffd700; margin-bottom:15px;">우승자: ${data.winner.name} ($${data.winner.totalMoney.toLocaleString()})</h3><ol style="padding-left:20px;">`;
    const sorted = [...data.players].sort((a,b) => b.totalMoney - a.totalMoney);
    sorted.forEach(p => {
      bodyHTML += `<li><b>${p.name}</b>: $${p.totalMoney.toLocaleString()}</li>`;
    });
    bodyHTML += `</ol>`;
    modalBody.innerHTML = bodyHTML;
    confirmBtn.classList.add('hidden');
    nextBtn.classList.add('hidden');
  } else {
    modalTitle.innerText = `ROUND ${data.round} 정산`;
    let bodyHTML = '';
    for (let c = 1; c <= 6; c++) {
      bodyHTML += `<div style="margin-bottom:8px;"><b>[카지노 ${c}]</b> `;
      if (data.results[c] && data.results[c].length > 0) {
        bodyHTML += data.results[c].map(w => `${w.playerName} ($${w.amount.toLocaleString()})`).join(', ');
      } else {
        bodyHTML += `<span style="color:#888;">획득자 없음 (폭파/무효)</span>`;
      }
      bodyHTML += `</div>`;
    }
    modalBody.innerHTML = bodyHTML;
    confirmBtn.classList.remove('hidden');

    if (gameState && gameState.hostId === myPlayerId) nextBtn.classList.remove('hidden');
    else nextBtn.classList.add('hidden');
  }
});

function renderUI() {
  if (!gameState || isRollingAnimation) return;

  document.getElementById('round-num').innerText = gameState.round;

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

  const startBtn = document.getElementById('start-btn');
  if (gameState.state === 'WAITING' && gameState.hostId === myPlayerId) startBtn.classList.remove('hidden');
  else startBtn.classList.add('hidden');

  const statusText = document.getElementById('status-text');
  const isMyTurn = gameState.currentTurnPlayerId === myPlayerId;
  
  if (gameState.state === 'WAITING') {
    statusText.innerText = '대기실 - 인원이 모이면 방장이 게임 시작 버튼을 누르세요.';
  } else if (gameState.state === 'COLOR_SELECTION') {
    statusText.innerText = '원하는 색상을 뽑아 턴 순서를 정해 보세요!';
  } else if (gameState.state === 'PLAYING') {
    const turnPlayer = gameState.players[gameState.currentTurnIndex];
    statusText.innerText = isMyTurn ? '🔥 당신의 턴입니다!' : `${turnPlayer?.name || ''}님 턴 진행 중...`;
  }

  const playersContainer = document.getElementById('players-list');
  playersContainer.innerHTML = '';
  gameState.players.forEach((p, idx) => {
    const card = document.createElement('div');
    const isTurn = gameState.state === 'PLAYING' && idx === gameState.currentTurnIndex;
    
    card.className = `player-card ${isTurn ? 'active' : ''}`;
    card.style.borderTopColor = p.color;

    if (gameState.state === 'PLAYING' && p.diceCount === 0) card.style.opacity = '0.4';
    else card.style.opacity = '1';

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
          diceHTML += create2DDiceHTML(c, player.color, player.textColor);
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

  const rollBtn = document.getElementById('roll-btn');
  const myPlayer = gameState.players.find(p => p.id === myPlayerId);

  // 주사위 굴리기 버튼 상태 갱신
  if (gameState.state === 'PLAYING' && isMyTurn && myPlayer && myPlayer.diceCount > 0 && myPlayer.currentRoll.length === 0) {
    rollBtn.disabled = false;
    rollBtn.style.opacity = '1';
    rollBtn.style.cursor = 'pointer';
  } else {
    rollBtn.disabled = true;
    rollBtn.style.opacity = '0.4';
    rollBtn.style.cursor = 'not-allowed';
  }
}
