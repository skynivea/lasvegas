const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket', 'polling']
});

app.use(express.static('public')); // 클라이언트 정적 파일 경로

// 사용 가능한 지폐 덱 (원 단위 기본 구성)
const INITIAL_MONEY_DECK = [
  ...Array(6).fill(10000),
  ...Array(8).fill(20000),
  ...Array(8).fill(30000),
  ...Array(6).fill(40000),
  ...Array(6).fill(50000),
  ...Array(5).fill(60000),
  ...Array(5).fill(70000),
  ...Array(5).fill(80000),
  ...Array(5).fill(90000)
];

const rooms = {};

// 배열 셔플 함수
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// 방 코드 생성기 (4자리 대문자)
function generateRoomCode() {
  let code = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms[code] ? generateRoomCode() : code;
}

// 카지노 머니 세팅 (최소 50,000원 이상이 되도록 채움)
function dealMoneyToCasinos(room) {
  room.casinos = {};
  for (let c = 1; c <= 6; c++) {
    room.casinos[c] = { bills: [], dicePlaced: {} };
    let total = 0;
    while (total < 50000 && room.moneyDeck.length > 0) {
      const bill = room.moneyDeck.pop();
      room.casinos[c].bills.push(bill);
      total += bill;
    }
    // 내림차순 정렬 (큰 돈부터 상금 배분)
    room.casinos[c].bills.sort((a, b) => b - a);
  }
}

// 새 라운드 시작 초기화
function startNewRound(room) {
  room.diceToRollCount = 8;
  room.confirmedPlayers.clear();

  if (room.moneyDeck.length < 15) {
    room.moneyDeck = shuffle([...INITIAL_MONEY_DECK]);
  }

  dealMoneyToCasinos(room);

  // 플레이어 주사위/굴림 상태 초기화
  room.players.forEach(p => {
    p.diceCount = 8;
    p.currentRoll = [];
  });

  // 턴 순서 정하기
  room.currentTurnIndex = (room.round - 1) % room.players.length;
  room.currentTurnPlayerId = room.players[room.currentTurnIndex].id;
}

io.on('connection', (socket) => {
  // 1. 방 생성
  socket.on('createRoom', ({ name }) => {
    const roomCode = generateRoomCode();
    const player = {
      id: socket.id,
      name,
      color: null,
      textColor: '#FFFFFF',
      diceCount: 8,
      totalMoney: 0,
      currentRoll: [],
      turnOrder: null
    };

    rooms[roomCode] = {
      code: roomCode,
      hostId: socket.id,
      state: 'WAITING', // WAITING -> COLOR_SELECTION -> PLAYING -> GAME_OVER
      round: 1,
      maxRounds: 4,
      players: [player],
      colorSelectionMap: {
        black: { selectedBy: null, orderNum: 1 },
        white: { selectedBy: null, orderNum: 2 },
        red: { selectedBy: null, orderNum: 3 },
        blue: { selectedBy: null, orderNum: 4 }
      },
      casinos: {},
      moneyDeck: shuffle([...INITIAL_MONEY_DECK]),
      currentTurnIndex: 0,
      currentTurnPlayerId: null,
      confirmedPlayers: new Set()
    };

    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, playerId: socket.id });
    io.to(roomCode).emit('gameStateUpdate', rooms[roomCode]);
  });

  // 2. 방 참가
  socket.on('joinRoom', ({ name, roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('errorMsg', '존재하지 않는 방 코드입니다.');
    if (room.state !== 'WAITING') return socket.emit('errorMsg', '이미 게임이 진행 중입니다.');
    if (room.players.length >= 4) return socket.emit('errorMsg', '방이 가득 찼습니다. (최대 4명)');

    const player = {
      id: socket.id,
      name,
      color: null,
      textColor: '#FFFFFF',
      diceCount: 8,
      totalMoney: 0,
      currentRoll: [],
      turnOrder: null
    };

    room.players.push(player);
    socket.join(roomCode);

    socket.emit('roomJoined', { roomCode, playerId: socket.id });
    io.to(roomCode).emit('gameStateUpdate', room);
  });

  // 3. 게임 시작 (색상 선택 단계로 이동)
  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return socket.emit('errorMsg', '최소 2명 이상이어야 시작할 수 있습니다.');

    room.state = 'COLOR_SELECTION';
    io.to(roomCode).emit('gameStateUpdate', room);
  });

  // 4. 색상 뽑기
  socket.on('pickColor', ({ roomCode, colorKey }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'COLOR_SELECTION') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.color) return;

    const colorData = room.colorSelectionMap[colorKey];
    if (colorData.selectedBy) return;

    const COLOR_HEX_MAP = {
      black: { code: '#212529', text: '#FFFFFF' },
      white: { code: '#F8F9FA', text: '#212529' },
      red: { code: '#E63946', text: '#FFFFFF' },
      blue: { code: '#1D3557', text: '#FFFFFF' }
    };

    colorData.selectedBy = player.name;
    player.color = COLOR_HEX_MAP[colorKey].code;
    player.textColor = COLOR_HEX_MAP[colorKey].text;
    player.turnOrder = colorData.orderNum;

    // 모든 플레이어가 색상을 뽑았는지 확인
    const allPicked = room.players.every(p => p.color !== null);
    if (allPicked) {
      room.players.sort((a, b) => a.turnOrder - b.turnOrder);
      room.state = 'PLAYING';
      room.round = 1;

      startNewRound(room);
      io.to(roomCode).emit('startMoneyDealingSequence');
    }

    io.to(roomCode).emit('gameStateUpdate', room);
  });

  // 5. 주사위 굴리기 (방 안의 전체 플레이어에게 굴림 애니메이션 알림)
  socket.on('rollDice', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'PLAYING') return;
    if (room.currentTurnPlayerId !== socket.id) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.diceCount <= 0) return;

    // 🎬 굴림 시작을 방 안의 모든 플레이어에게 전달 (관전)
    io.to(roomCode).emit('playerRolling', { playerId: socket.id, diceCount: player.diceCount });

    player.currentRoll = [];
    for (let i = 0; i < player.diceCount; i++) {
      player.currentRoll.push(Math.floor(Math.random() * 6) + 1);
    }

    io.to(roomCode).emit('gameStateUpdate', room);
  });

  // 6. 주사위 배치
  socket.on('placeDice', ({ roomCode, diceValue }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'PLAYING') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || room.currentTurnPlayerId !== socket.id) return;

    const count = player.currentRoll.filter(v => v === diceValue).length;
    if (count === 0) return;

    // 카지노에 해당 플레이어 주사위 추가
    if (!room.casinos[diceValue].dicePlaced[player.id]) {
      room.casinos[diceValue].dicePlaced[player.id] = 0;
    }
    room.casinos[diceValue].dicePlaced[player.id] += count;

    player.diceCount -= count;
    player.currentRoll = [];

    // 다음 주사위가 남아있는 플레이어 찾기
    let nextIdx = (room.currentTurnIndex + 1) % room.players.length;
    let loopCount = 0;

    while (room.players[nextIdx].diceCount === 0 && loopCount < room.players.length) {
      nextIdx = (nextIdx + 1) % room.players.length;
      loopCount++;
    }

    // 모든 플레이어가 주사위를 전부 소진함 -> 라운드 정산
    if (loopCount >= room.players.length) {
      resolveRound(roomCode);
    } else {
      room.currentTurnIndex = nextIdx;
      room.currentTurnPlayerId = room.players[nextIdx].id;
      io.to(roomCode).emit('gameStateUpdate', room);
    }
  });

  // 💬 채팅 전송
  socket.on('sendChat', ({ roomCode, message }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    io.to(roomCode).emit('receiveChat', {
      senderName: player.name,
      color: player.color || '#FFD700',
      message
    });
  });

  // 7. 정산 확인 완료
  socket.on('confirmResult', ({ roomCode }) => {
    socket.emit('closeModal');
  });

  // 8. 다음 라운드 진행 (방장 권한)
  socket.on('nextRound', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;

    room.round++;
    startNewRound(room);

    io.to(roomCode).emit('closeModal');
    io.to(roomCode).emit('startMoneyDealingSequence');
    io.to(roomCode).emit('gameStateUpdate', room);
  });

  // 9. 게임 재시작 (방장 권한 - 방 유지 후 색상 선택으로 복귀)
  socket.on('restartGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;

    room.state = 'COLOR_SELECTION';
    room.round = 1;
    room.moneyDeck = shuffle([...INITIAL_MONEY_DECK]);

    Object.keys(room.colorSelectionMap).forEach(key => {
      room.colorSelectionMap[key].selectedBy = null;
    });

    room.players.forEach(p => {
      p.color = null;
      p.textColor = '#FFFFFF';
      p.diceCount = 8;
      p.totalMoney = 0;
      p.currentRoll = [];
      p.turnOrder = null;
    });

    io.to(roomCode).emit('closeModal');
    io.to(roomCode).emit('gameStateUpdate', room);
  });

  // 연결 해제 처리
  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          delete rooms[code];
        } else {
          if (room.hostId === socket.id) {
            room.hostId = room.players[0].id; // 방장 위임
          }
          io.to(code).emit('gameStateUpdate', room);
        }
        break;
      }
    }
  });
});

// 라운드 정산 처리 로직
function resolveRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const roundResults = {};

  for (let c = 1; c <= 6; c++) {
    const casino = room.casinos[c];
    roundResults[c] = [];

    // 동일 개수 주사위(동점자) 무효화 처리
    const counts = {};
    Object.entries(casino.dicePlaced).forEach(([pId, count]) => {
      if (count > 0) {
        counts[count] = counts[count] || [];
        counts[count].push(pId);
      }
    });

    const validRanks = [];
    Object.keys(counts).map(Number).sort((a, b) => b - a).forEach(cnt => {
      if (counts[cnt].length === 1) {
        validRanks.push(counts[cnt][0]);
      }
    });

    // 지폐 상금 배분 (큰 지폐부터 순서대로)
    const bills = [...casino.bills];
    validRanks.forEach(pId => {
      if (bills.length > 0) {
        const wonBill = bills.shift();
        const player = room.players.find(p => p.id === pId);
        if (player) {
          player.totalMoney += wonBill;
          roundResults[c].push({
            playerName: player.name,
            amount: wonBill
          });
        }
      }
    });
  }

  const isGameOver = room.round >= room.maxRounds;
  let winner = null;

  if (isGameOver) {
    room.state = 'GAME_OVER';
    const sorted = [...room.players].sort((a, b) => b.totalMoney - a.totalMoney);
    winner = sorted[0];
  }

  io.to(roomCode).emit('roundResolved', {
    round: room.round,
    results: roundResults,
    isGameOver,
    winner,
    players: room.players
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
