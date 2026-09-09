const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const ROOMS = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 54장 지폐 더미 생성 함수
function createMoneyDeck() {
  const deck = [];
  const denominations = [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000];
  denominations.forEach(amount => {
    for (let i = 0; i < 6; i++) {
      deck.push(amount);
    }
  });
  return shuffle(deck);
}

// 카지노에 $50,000 이상 순차 배분 (기존 지폐 초기화 보완)
function setupCasinos(room) {
  for (let c = 1; c <= 6; c++) {
    room.casinos[c] = { bills: [], dicePlaced: {} }; // 라운드 시작 시 이전 남은 지폐 리셋
    let currentSum = 0;

    while (currentSum < 50000) {
      if (room.moneyDeck.length === 0) {
        room.moneyDeck = createMoneyDeck();
      }
      const bill = room.moneyDeck.pop();
      room.casinos[c].bills.push(bill);
      currentSum += bill;
    }
    room.casinos[c].bills.sort((a, b) => b - a);
  }
}

// 다음 턴 플레이어 검색 (무한루프 방지 Safe Next Turn)
function advanceToNextTurn(room) {
  let activePlayers = room.players.filter(p => p.diceCount > 0);
  if (activePlayers.length === 0) return true; // 라운드 종료 조건

  let attempts = 0;
  do {
    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    attempts++;
  } while (room.players[room.currentTurnIndex].diceCount === 0 && attempts < room.players.length * 2);

  room.currentTurnPlayerId = room.players[room.currentTurnIndex].id;
  return false;
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }) => {
    const roomCode = generateRoomCode();
    ROOMS[roomCode] = {
      code: roomCode,
      hostId: socket.id,
      state: 'WAITING',
      round: 1,
      startPlayerIndex: 0, // 선공 인덱스 관리
      players: [{ id: socket.id, name, totalMoney: 0, diceCount: 8, currentRoll: [], turnOrder: 0, color: '#ffd700', textColor: '#000' }],
      casinos: {},
      moneyDeck: createMoneyDeck(),
      currentTurnIndex: 0,
      currentTurnPlayerId: null,
      confirmations: new Set(),
      colorSelectionMap: {}
    };
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, playerId: socket.id });
    io.to(roomCode).emit('gameStateUpdate', ROOMS[roomCode]);
  });

  socket.on('joinRoom', ({ name, roomCode }) => {
    const room = ROOMS[roomCode];
    if (!room) return socket.emit('errorMsg', '존재하지 않는 방입니다.');
    if (room.state !== 'WAITING') return socket.emit('errorMsg', '이미 게임이 진행 중입니다.');
    if (room.players.length >= 4) return socket.emit('errorMsg', '방이 가득 찼습니다.');

    room.players.push({ id: socket.id, name, totalMoney: 0, diceCount: 8, currentRoll: [], turnOrder: 0, color: '#ccc', textColor: '#000' });
    socket.join(roomCode);
    socket.emit('roomJoined', { roomCode, playerId: socket.id });
    io.to(roomCode).emit('gameStateUpdate', room);
  });

  socket.on('sendChat', ({ roomCode, message }) => {
    const room = ROOMS[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !message || message.trim() === '') return;

    io.to(roomCode).emit('receiveChat', {
      senderName: player.name,
      color: player.color,
      message: message.trim()
    });
  });

  socket.on('startGame', ({ roomCode }) => {
    const room = ROOMS[roomCode];
    if (!room || room.hostId !== socket.id) return;

    room.state = 'COLOR_SELECTION';
    const colors = [
      { key: 'black', color: '#212529', textColor: '#FFFFFF' },
      { key: 'white', color: '#F8F9FA', textColor: '#212529' },
      { key: 'red', color: '#E63946', textColor: '#FFFFFF' },
      { key: 'blue', color: '#1D3557', textColor: '#FFFFFF' }
    ];
    
    const orders = shuffle([1, 2, 3, 4]).slice(0, room.players.length);
    room.colorSelectionMap = {};
    colors.slice(0, room.players.length).forEach((c, idx) => {
      room.colorSelectionMap[c.key] = { ...c, orderNum: orders[idx], selectedBy: null };
    });

    io.to(roomCode).emit('gameStateUpdate', room);
  });

  socket.on('pickColor', ({ roomCode, colorKey }) => {
    const room = ROOMS[roomCode];
    if (!room || room.state !== 'COLOR_SELECTION') return;

    const target = room.colorSelectionMap[colorKey];
    if (!target || target.selectedBy) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    target.selectedBy = player.name;
    player.color = target.color;
    player.textColor = target.textColor;
    player.turnOrder = target.orderNum;

    const allPicked = Object.values(room.colorSelectionMap).every(v => v.selectedBy !== null);
    if (allPicked) {
      room.players.sort((a, b) => a.turnOrder - b.turnOrder);
      room.state = 'PLAYING';
      room.startPlayerIndex = 0;
      room.currentTurnIndex = 0;
      room.currentTurnPlayerId = room.players[0].id;
      setupCasinos(room);
      io.to(roomCode).emit('gameStateUpdate', room);
      io.to(roomCode).emit('startMoneyDealingSequence');
    } else {
      io.to(roomCode).emit('gameStateUpdate', room);
    }
  });

  socket.on('rollDice', ({ roomCode }) => {
    const room = ROOMS[roomCode];
    if (!room || room.state !== 'PLAYING') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.id !== room.currentTurnPlayerId) return;

    player.currentRoll = Array.from({ length: player.diceCount }, () => Math.floor(Math.random() * 6) + 1);
    io.to(roomCode).emit('gameStateUpdate', room);
  });

  socket.on('placeDice', ({ roomCode, diceValue }) => {
    const room = ROOMS[roomCode];
    if (!room || room.state !== 'PLAYING') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.id !== room.currentTurnPlayerId) return;

    const count = player.currentRoll.filter(v => v === diceValue).length;
    if (count === 0) return;

    if (!room.casinos[diceValue].dicePlaced[player.id]) {
      room.casinos[diceValue].dicePlaced[player.id] = 0;
    }
    room.casinos[diceValue].dicePlaced[player.id] += count;
    player.diceCount -= count;
    player.currentRoll = [];

    const isRoundOver = advanceToNextTurn(room);

    if (isRoundOver) {
      resolveRound(roomCode);
    } else {
      io.to(roomCode).emit('gameStateUpdate', room);
    }
  });

  function resolveRound(roomCode) {
    const room = ROOMS[roomCode];
    if (!room) return;
    const roundResults = {};

    for (let c = 1; c <= 6; c++) {
      const casino = room.casinos[c];
      roundResults[c] = [];

      const countsMap = {};
      Object.keys(casino.dicePlaced).forEach(pId => {
        const count = casino.dicePlaced[pId];
        if (count > 0) countsMap[count] = (countsMap[count] || []).concat(pId);
      });

      // 동률 상쇄 제거
      const validPlayers = [];
      Object.keys(countsMap).forEach(cntStr => {
        if (countsMap[cntStr].length === 1) {
          validPlayers.push({
            id: countsMap[cntStr][0],
            count: parseInt(cntStr, 10)
          });
        }
      });

      validPlayers.sort((a, b) => b.count - a.count);

      const bills = [...casino.bills];
      validPlayers.forEach((p, idx) => {
        if (bills[idx] !== undefined) {
          const winner = room.players.find(pl => pl.id === p.id);
          if (winner) {
            winner.totalMoney += bills[idx];
            roundResults[c].push({ playerName: winner.name, amount: bills[idx] });
          }
        }
      });
    }

    const isGameOver = room.round >= 4;
    let winner = null;
    if (isGameOver) {
      winner = [...room.players].sort((a, b) => b.totalMoney - a.totalMoney)[0];
    }

    room.confirmations.clear();
    io.to(roomCode).emit('roundResolved', {
      round: room.round,
      results: roundResults,
      isGameOver,
      winner,
      players: room.players
    });
  }

  socket.on('confirmResult', ({ roomCode }) => {
    const room = ROOMS[roomCode];
    if (!room) return;
    room.confirmations.add(socket.id);
    io.to(roomCode).emit('updateConfirmCount', { count: room.confirmations.size, total: room.players.length });

    if (room.confirmations.size >= room.players.length) {
      startNextRound(roomCode);
    }
  });

  socket.on('nextRound', ({ roomCode }) => {
    const room = ROOMS[roomCode];
    if (room && room.hostId === socket.id) startNextRound(roomCode);
  });

  function startNextRound(roomCode) {
    const room = ROOMS[roomCode];
    if (!room) return;

    room.round += 1;
    room.players.forEach(p => { p.diceCount = 8; p.currentRoll = []; });
    
    // 매 라운드마다 선공(Start Player)을 시계 방향으로 이동
    room.startPlayerIndex = (room.startPlayerIndex + 1) % room.players.length;
    room.currentTurnIndex = room.startPlayerIndex;
    room.currentTurnPlayerId = room.players[room.startPlayerIndex].id;
    
    setupCasinos(room);

    io.to(roomCode).emit('closeModal');
    io.to(roomCode).emit('gameStateUpdate', room);
    io.to(roomCode).emit('startMoneyDealingSequence');
  }

  socket.on('disconnect', () => {
    Object.keys(ROOMS).forEach(code => {
      const room = ROOMS[code];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          delete ROOMS[code];
        } else {
          if (room.hostId === socket.id) {
            room.hostId = room.players[0].id;
          }
          if (room.state === 'PLAYING') {
            advanceToNextTurn(room);
          }
          io.to(code).emit('gameStateUpdate', room);
        }
      }
    });
  });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));
