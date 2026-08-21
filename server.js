const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});

function createMoneyDeck() {
  const denominations = [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000];
  let deck = [];
  denominations.forEach(amount => {
    for (let i = 0; i < 8; i++) deck.push(amount);
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const COLOR_MAP = {
  black: { code: '#212529', name: '검정', text: '#FFFFFF' },
  white: { code: '#F8F9FA', name: '하양', text: '#212529' },
  red: { code: '#E63946', name: '빨강', text: '#FFFFFF' },
  blue: { code: '#1D3557', name: '파랑', text: '#FFFFFF' }
};

const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

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
    bills.sort((a, b) => b - a);
    room.casinos[i] = { bills, dicePlaced: {} };
  }
}

// 라운드별 선 순서 정렬 (2~4라운드는 돈 많은 순서)
function sortTurnOrder(room) {
  if (room.round > 1) {
    room.players.sort((a, b) => {
      if (b.totalMoney !== a.totalMoney) return b.totalMoney - a.totalMoney;
      return b.cardsWon - a.cardsWon;
    });
  }
}

function startRound(room) {
  sortTurnOrder(room);
  room.currentTurnIndex = 0;
  setupCasinosForRound(room);
  
  room.players.forEach(p => {
    p.diceCount = 8;
    p.currentRoll = [];
  });

  room.state = 'PLAYING';
  broadcastGameState(room.code);
}

function checkNextTurn(room) {
  const activePlayers = room.players.filter(p => p.diceCount > 0);
  if (activePlayers.length === 0) {
    resolveRound(room);
    return;
  }

  let nextIdx = (room.currentTurnIndex + 1) % room.players.length;
  let safety = 0;
  while (room.players[nextIdx].diceCount === 0 && safety < room.players.length) {
    nextIdx = (nextIdx + 1) % room.players.length;
    safety++;
  }
  room.currentTurnIndex = nextIdx;
  room.players[room.currentTurnIndex].currentRoll = [];
  broadcastGameState(room.code);
}

function resolveRound(room) {
  const roundResults = {};

  for (let c = 1; c <= 6; c++) {
    const casino = room.casinos[c];
    const placed = casino.dicePlaced;

    let counts = [];
    Object.keys(placed).forEach(pId => {
      if (placed[pId] > 0) counts.push({ id: pId, count: placed[pId] });
    });
    counts.sort((a, b) => b.count - a.count);

    let validWinners = [];
    let i = 0;
    while (i < counts.length) {
      let group = [counts[i]];
      let j = i + 1;
      while (j < counts.length && counts[j].count === counts[i].count) {
        group.push(counts[j]);
        j++;
      }
      if (group.length === 1) validWinners.push(group[0]);
      i = j;
    }

    let moneyAvailable = [...casino.bills];
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
    let sorted = [...room.players].sort((a, b) => b.totalMoney - a.totalMoney || b.cardsWon - a.cardsWon);
    room.winner = sorted[0];
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
    casinos: room.casinos,
    colorSelectionMap: room.colorSelectionMap
  });
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }) => {
    let code = generateRoomCode();
    while (rooms[code]) code = generateRoomCode();

    const newPlayer = {
      id: socket.id,
      name: name || '플레이어1',
      colorKey: null,
      color: '#888888',
      textColor: '#FFFFFF',
      colorName: '미정',
      turnOrder: 0,
      diceCount: 8,
      currentRoll: [],
      totalMoney: 0,
      cardsWon: 0
    };

    rooms[code] = {
      code,
      hostId: socket.id,
      players: [newPlayer],
      round: 1,
      state: 'WAITING',
      moneyDeck: createMoneyDeck(),
      casinos: {},
      currentTurnIndex: 0,
      colorSelectionMap: {}
    };

    socket.join(code);
    socket.emit('roomCreated', { roomCode: code, playerId: socket.id });
    broadcastGameState(code);
  });

  socket.on('joinRoom', ({ name, roomCode }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];

    if (!room) return socket.emit('errorMsg', '존재하지 않는 방 코드입니다.');
    if (room.players.length >= 4) return socket.emit('errorMsg', '방이 가득 찼습니다. (최대 4인)');
    if (room.state !== 'WAITING') return socket.emit('errorMsg', '이미 게임이 진행 중입니다.');

    const newPlayer = {
      id: socket.id,
      name: name || `플레이어${room.players.length + 1}`,
      colorKey: null,
      color: '#888888',
      textColor: '#FFFFFF',
      colorName: '미정',
      turnOrder: 0,
      diceCount: 8,
      currentRoll: [],
      totalMoney: 0,
      cardsWon: 0
    };

    room.players.push(newPlayer);
    socket.join(code);
    socket.emit('roomJoined', { roomCode: code, playerId: socket.id });
    
    io.to(code).emit('chatMessage', { system: true, text: `${newPlayer.name}님이 입장하셨습니다.` });
    broadcastGameState(code);
  });

  // 방장이 게임 시작 버튼 누름 -> 주사위 색상 뽑기 단계 진입
  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return socket.emit('errorMsg', '최소 2인 이상이어야 시작할 수 있습니다.');

    // 색상별로 안 겹치게 1 ~ 인원수 만큼 번작 무작위 부여
    const colorKeys = ['black', 'white', 'red', 'blue'].slice(0, room.players.length);
    let orders = Array.from({ length: room.players.length }, (_, i) => i + 1);
    
    // 번호 셔플
    for (let i = orders.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [orders[i], orders[j]] = [orders[j], orders[i]];
    }

    room.colorSelectionMap = {};
    colorKeys.forEach((key, idx) => {
      room.colorSelectionMap[key] = {
        orderNum: orders[idx],
        selectedBy: null
      };
    });

    room.state = 'COLOR_SELECTION';
    io.to(roomCode).emit('chatMessage', { system: true, text: '주사위 색상을 선택하여 1라운드 턴 순서를 결정하세요!' });
    broadcastGameState(roomCode);
  });

  // 색상 뽑기 선택 이벤트
  socket.on('pickColor', ({ roomCode, colorKey }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'COLOR_SELECTION') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.colorKey) return socket.emit('errorMsg', '이미 색상을 고르셨습니다.');

    if (room.colorSelectionMap[colorKey].selectedBy) {
      return socket.emit('errorMsg', '이미 다른 사람이 선택한 색상입니다.');
    }

    // 색상 및 턴 번호 할당
    const targetColor = COLOR_MAP[colorKey];
    const assignedOrder = room.colorSelectionMap[colorKey].orderNum;

    room.colorSelectionMap[colorKey].selectedBy = player.name;
    player.colorKey = colorKey;
    player.color = targetColor.code;
    player.textColor = targetColor.text;
    player.colorName = targetColor.name;
    player.turnOrder = assignedOrder;

    io.to(roomCode).emit('chatMessage', {
      system: true,
      text: `${player.name}님이 [${targetColor.name}] 색상을 선택하여 [${assignedOrder}번 턴]을 뽑았습니다!`
    });

    // 전원 다 골랐는지 확인
    const allPicked = room.players.every(p => p.colorKey !== null);
    if (allPicked) {
      // 1라운드는 뽑은 턴 번호 순서(1번->2번->3번)대로 정렬
      room.players.sort((a, b) => a.turnOrder - b.turnOrder);
      room.round = 1;
      startRound(room);
    } else {
      broadcastGameState(roomCode);
    }
  });

  socket.on('rollDice', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'PLAYING') return;

    const currPlayer = room.players[room.currentTurnIndex];
    if (currPlayer.id !== socket.id) return socket.emit('errorMsg', '당신의 턴이 아닙니다.');
    if (currPlayer.diceCount <= 0) return checkNextTurn(room);

    let rolls = [];
    for (let i = 0; i < currPlayer.diceCount; i++) {
      rolls.push(Math.floor(Math.random() * 6) + 1);
    }
    rolls.sort((a, b) => a - b);
    currPlayer.currentRoll = rolls;

    broadcastGameState(roomCode);
  });

  socket.on('placeDice', ({ roomCode, diceValue }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'PLAYING') return;

    const currPlayer = room.players[room.currentTurnIndex];
    if (currPlayer.id !== socket.id) return;

    const countToPlace = currPlayer.currentRoll.filter(val => val === diceValue).length;
    if (countToPlace === 0) return socket.emit('errorMsg', '선택 가능한 눈이 아닙니다.');

    const casino = room.casinos[diceValue];
    casino.dicePlaced[socket.id] = (casino.dicePlaced[socket.id] || 0) + countToPlace;

    currPlayer.diceCount -= countToPlace;
    currPlayer.currentRoll = [];

    io.to(roomCode).emit('chatMessage', {
      system: true,
      text: `${currPlayer.name}님이 [카지노 ${diceValue}]에 주사위 ${countToPlace}개를 놓았습니다.`
    });

    checkNextTurn(room);
  });

  socket.on('nextRound', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.state === 'ROUND_END') {
      room.round += 1;
      startRound(room);
      io.to(roomCode).emit('chatMessage', { system: true, text: `라운드 ${room.round} 시작! 돈이 가장 많은 사람부터 선 순서가 부여됩니다.` });
    }
  });

  socket.on('sendChat', ({ roomCode, message }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      io.to(roomCode).emit('chatMessage', { sender: player.name, color: player.color, text: message });
    }
  });

  socket.on('disconnect', () => {
    Object.keys(rooms).forEach(code => {
      const room = rooms[code];
      const pIdx = room.players.findIndex(p => p.id === socket.id);
      if (pIdx !== -1) {
        const leftPlayer = room.players[pIdx];
        const isTurnPlayer = room.currentTurnIndex === pIdx;

        room.players.splice(pIdx, 1);
        io.to(code).emit('chatMessage', { system: true, text: `${leftPlayer.name}님이 퇴장하셨습니다.` });

        if (room.players.length === 0) {
          delete rooms[code];
        } else {
          if (room.hostId === socket.id) room.hostId = room.players[0].id;
          if (room.state === 'PLAYING' && isTurnPlayer) {
            checkNextTurn(room);
          } else {
            broadcastGameState(code);
          }
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`서버 포트: ${PORT}`));
