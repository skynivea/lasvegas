const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 지폐 카드 덱 생성 ($10k ~ $90k, 각 8장씩 총 72장)
function createMoneyDeck() {
  const denominations = [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000];
  let deck = [];
  denominations.forEach(amount => {
    for (let i = 0; i < 8; i++) {
      deck.push(amount);
    }
  });
  // 셔플
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const PLAYER_COLORS = ['#E63946', '#1D3557', '#2A9D8F', '#E76F51']; // Red, Navy, Teal, Orange
const COLOR_NAMES = ['레드', '네이비', '민트', '오렌지'];

const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 각 카지노마다 총합이 최소 $50,000 이상이 될 때까지 돈 배치
function setupCasinosForRound(room) {
  room.casinos = {};
  for (let i = 1; i <= 6; i++) {
    let bills = [];
    let total = 0;
    while (total < 50000 && room.moneyDeck.length > 0) {
      const card = room.moneyDeck.pop();
      bills.push(card);
      total += card;
    }
    // 돈 카드는 높은 금액 순으로 정렬
    bills.sort((a, b) => b - a);
    
    room.casinos[i] = {
      bills: bills,
      dicePlaced: {} // { playerId: count }
    };
  }
}

function startRound(room) {
  room.currentTurnIndex = (room.round - 1) % room.players.length;
  setupCasinosForRound(room);
  
  // 플레이어별 주사위 8개 초기화
  room.players.forEach(p => {
    p.diceCount = 8;
    p.currentRoll = [];
  });

  room.state = 'PLAYING';
  broadcastGameState(room.code);
}

function checkNextTurn(room) {
  // 남아있는 주사위가 있는 플레이어가 존재하는지 검사
  const activePlayers = room.players.filter(p => p.diceCount > 0);
  
  if (activePlayers.length === 0) {
    // 모든 주사위 소진 -> 라운드 정산
    resolveRound(room);
    return;
  }

  // 다음 플레이어로 턴 넘기기
  let nextIdx = (room.currentTurnIndex + 1) % room.players.length;
  while (room.players[nextIdx].diceCount === 0) {
    nextIdx = (nextIdx + 1) % room.players.length;
  }
  room.currentTurnIndex = nextIdx;
  
  // 새 턴의 플레이어에게 자동 주사위 굴리기 유도 상태
  room.players[room.currentTurnIndex].currentRoll = [];
  broadcastGameState(room.code);
}

// 라운드 정산 (동점 상쇄 폭파 및 돈 분배)
function resolveRound(room) {
  const roundResults = {};

  for (let c = 1; c <= 6; c++) {
    const casino = room.casinos[c];
    const placed = casino.dicePlaced; // { socketId: count }

    // 1. 플레이어들의 주사위 개수 카운트 및 정렬
    let counts = [];
    Object.keys(placed).forEach(pId => {
      if (placed[pId] > 0) {
        counts.push({ id: pId, count: placed[pId] });
      }
    });

    // 주사위 많은 순 정렬
    counts.sort((a, b) => b.count - a.count);

    // 2. 동점 상쇄 (폭파 처리)
    let validWinners = [];
    let i = 0;
    while (i < counts.length) {
      let sameCountGroup = [counts[i]];
      let j = i + 1;
      while (j < counts.length && counts[j].count === counts[i].count) {
        sameCountGroup.push(counts[j]);
        j++;
      }
      if (sameCountGroup.length === 1) {
        validWinners.push(sameCountGroup[0]); // 유일한 최고수만 인정
      } else {
        // 동점자는 폭파(무효화)
      }
      i = j;
    }

    // 3. 돈 분배
    let moneyAvailable = [...casino.bills]; // 이미 내림차순 정렬됨
    roundResults[c] = [];

    for (let w = 0; w < validWinners.length; w++) {
      if (moneyAvailable.length > 0) {
        const wonMoney = moneyAvailable.shift();
        const winnerPlayer = room.players.find(p => p.id === validWinners[w].id);
        if (winnerPlayer) {
          winnerPlayer.totalMoney += wonMoney;
          winnerPlayer.cardsWon += 1;
          roundResults[c].push({ playerName: winnerPlayer.name, amount: wonMoney });
        }
      }
    }
  }

  room.state = 'ROUND_END';
  
  if (room.round >= 4) {
    room.state = 'GAME_OVER';
    // 승자 판정 (돈 우선, 동점시 카드 장수)
    let sortedPlayers = [...room.players].sort((a, b) => {
      if (b.totalMoney !== a.totalMoney) return b.totalMoney - a.totalMoney;
      return b.cardsWon - a.cardsWon;
    });
    room.winner = sortedPlayers[0];
  }

  io.to(room.code).emit('roundResolved', {
    round: room.round,
    results: roundResults,
    players: room.players,
    isGameOver: room.state === 'GAME_OVER',
    winner: room.winner
  });
}

function broadcastGameState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  io.to(roomCode).emit('gameStateUpdate', {
    roomCode: room.code,
    hostId: room.hostId,
    round: room.round,
    state: room.state,
    currentTurnIndex: room.currentTurnIndex,
    currentTurnPlayerId: room.players[room.currentTurnIndex]?.id,
    players: room.players,
    casinos: room.casinos
  });
}

io.on('connection', (socket) => {
  // 1. 방 생성
  socket.on('createRoom', ({ name }) => {
    let code = generateRoomCode();
    while (rooms[code]) code = generateRoomCode();

    const newPlayer = {
      id: socket.id,
      name: name || '플레이어1',
      color: PLAYER_COLORS[0],
      colorName: COLOR_NAMES[0],
      diceCount: 8,
      currentRoll: [],
      totalMoney: 0,
      cardsWon: 0
    };

    rooms[code] = {
      code: code,
      hostId: socket.id,
      players: [newPlayer],
      round: 1,
      state: 'WAITING', // WAITING, PLAYING, ROUND_END, GAME_OVER
      moneyDeck: createMoneyDeck(),
      casinos: {},
      currentTurnIndex: 0
    };

    socket.join(code);
    socket.emit('roomCreated', { roomCode: code, playerId: socket.id });
    broadcastGameState(code);
  });

  // 2. 방 참가
  socket.on('joinRoom', ({ name, roomCode }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];

    if (!room) {
      socket.emit('errorMsg', '존재하지 않는 방 코드입니다.');
      return;
    }
    if (room.players.length >= 4) {
      socket.emit('errorMsg', '방이 가득 찼습니다. (최대 4인)');
      return;
    }
    if (room.state !== 'WAITING') {
      socket.emit('errorMsg', '이미 게임이 진행 중인 방입니다.');
      return;
    }

    const playerIdx = room.players.length;
    const newPlayer = {
      id: socket.id,
      name: name || `플레이어${playerIdx + 1}`,
      color: PLAYER_COLORS[playerIdx],
      colorName: COLOR_NAMES[playerIdx],
      diceCount: 8,
      currentRoll: [],
      totalMoney: 0,
      cardsWon: 0
    };

    room.players.push(newPlayer);
    socket.join(code);
    socket.emit('roomJoined', { roomCode: code, playerId: socket.id });
    
    io.to(code).emit('chatMessage', {
      system: true,
      text: `${newPlayer.name}님이 입장하셨습니다.`
    });

    broadcastGameState(code);
  });

  // 3. 게임 시작 (방장 전용)
  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('errorMsg', '방장만 게임을 시작할 수 있습니다.');
      return;
    }
    if (room.players.length < 2) {
      socket.emit('errorMsg', '최소 2인 이상이어야 시작할 수 있습니다.');
      return;
    }

    room.round = 1;
    startRound(room);
    io.to(roomCode).emit('chatMessage', { system: true, text: '게임이 시작되었습니다! 라운드 1' });
  });

  // 4. 주사위 굴리기
  socket.on('rollDice', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'PLAYING') return;

    const currPlayer = room.players[room.currentTurnIndex];
    if (currPlayer.id !== socket.id) {
      socket.emit('errorMsg', '당신의 턴이 아닙니다.');
      return;
    }

    if (currPlayer.diceCount <= 0) {
      checkNextTurn(room);
      return;
    }

    // 남은 주사위 전부 굴리기
    let rolls = [];
    for (let i = 0; i < currPlayer.diceCount; i++) {
      rolls.push(Math.floor(Math.random() * 6) + 1);
    }
    rolls.sort((a, b) => a - b);
    currPlayer.currentRoll = rolls;

    broadcastGameState(roomCode);
  });

  // 5. 주사위 배치하기 (카지노 선택)
  socket.on('placeDice', ({ roomCode, diceValue }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'PLAYING') return;

    const currPlayer = room.players[room.currentTurnIndex];
    if (currPlayer.id !== socket.id) return;

    const countToPlace = currPlayer.currentRoll.filter(val => val === diceValue).length;
    if (countToPlace === 0) {
      socket.emit('errorMsg', '굴린 주사위 목록에 해당 눈이 없습니다.');
      return;
    }

    // 카지노에 주사위 추가
    const casino = room.casinos[diceValue];
    if (!casino.dicePlaced[socket.id]) {
      casino.dicePlaced[socket.id] = 0;
    }
    casino.dicePlaced[socket.id] += countToPlace;

    // 플레이어의 남은 주사위 차감 및 굴림 초기화
    currPlayer.diceCount -= countToPlace;
    currPlayer.currentRoll = [];

    io.to(roomCode).emit('chatMessage', {
      system: true,
      text: `${currPlayer.name}님이 [카지노 ${diceValue}]에 주사위 ${countToPlace}개를 배치했습니다.`
    });

    // 다음 턴 체크
    checkNextTurn(room);
  });

  // 6. 다음 라운드 진행
  socket.on('nextRound', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;

    if (room.state === 'ROUND_END') {
      room.round += 1;
      startRound(room);
      io.to(roomCode).emit('chatMessage', { system: true, text: `라운드 ${room.round} 시작!` });
    }
  });

  // 7. 실시간 채팅
  socket.on('sendChat', ({ roomCode, message }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      io.to(roomCode).emit('chatMessage', {
        sender: player.name,
        color: player.color,
        text: message
      });
    }
  });

  // 연결 종료 처리
  socket.on('disconnect', () => {
    Object.keys(rooms).forEach(code => {
      const room = rooms[code];
      const pIdx = room.players.findIndex(p => p.id === socket.id);
      if (pIdx !== -1) {
        const leftPlayer = room.players[pIdx];
        room.players.splice(pIdx, 1);

        io.to(code).emit('chatMessage', {
          system: true,
          text: `${leftPlayer.name}님이 퇴장하셨습니다.`
        });

        if (room.players.length === 0) {
          delete rooms[code];
        } else {
          if (room.hostId === socket.id) {
            room.hostId = room.players[0].id;
          }
          broadcastGameState(code);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`라스베가스 게임 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
