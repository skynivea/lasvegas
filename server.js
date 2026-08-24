const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

const COLOR_MAP = {
  black: { code: '#212529', text: '#FFFFFF', name: '검정' },
  white: { code: '#F8F9FA', text: '#212529', name: '하양' },
  red: { code: '#E63946', text: '#FFFFFF', name: '빨강' },
  blue: { code: '#1D3557', text: '#FFFFFF', name: '파랑' }
};

const BASE_MONEY_DECK = [
  ...Array(5).fill(10000), ...Array(8).fill(20000), ...Array(8).fill(30000),
  ...Array(6).fill(40000), ...Array(6).fill(50000), ...Array(5).fill(60000),
  ...Array(5).fill(70000), ...Array(5).fill(80000), ...Array(6).fill(90000)
];

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function distributeMoneyToCasinos(moneyDeck) {
  const casinos = {};
  for (let c = 1; c <= 6; c++) {
    casinos[c] = { bills: [], dicePlaced: {} };
    let total = 0;
    while (total < 50000 && moneyDeck.length > 0) {
      const bill = moneyDeck.pop();
      casinos[c].bills.push(bill);
      total += bill;
    }
    casinos[c].bills.sort((a, b) => b - a);
  }
  return casinos;
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      code: roomCode,
      hostId: socket.id,
      state: 'WAITING',
      round: 1,
      moneyDeck: [],
      players: [{ id: socket.id, name, totalMoney: 0, cardsWon: 0, diceCount: 8, color: '#888', textColor: '#fff', turnOrder: null, currentRoll: [] }],
      casinos: {},
      currentTurnIndex: 0,
      colorSelectionMap: {},
      readyPlayers: new Set()
    };
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, playerId: socket.id });
    io.to(roomCode).emit('gameStateUpdate', rooms[roomCode]);
  });

  socket.on('joinRoom', ({ name, roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('errorMsg', '존재하지 않는 방입니다.');
    if (room.state !== 'WAITING') return socket.emit('errorMsg', '이미 진행 중인 게임입니다.');
    if (room.players.length >= 4) return socket.emit('errorMsg', '방이 가득 찼습니다.');

    room.players.push({ id: socket.id, name, totalMoney: 0, cardsWon: 0, diceCount: 8, color: '#888', textColor: '#fff', turnOrder: null, currentRoll: [] });
    socket.join(roomCode);
    socket.emit('roomJoined', { roomCode, playerId: socket.id });
    io.to(roomCode).emit('gameStateUpdate', room);
  });

  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return socket.emit('errorMsg', '최소 2명 이상 필요합니다.');

    room.state = 'COLOR_SELECTION';
    const keys = Object.keys(COLOR_MAP);
    const orders = shuffle([1, 2, 3, 4]).slice(0, room.players.length);

    room.colorSelectionMap = {};
    keys.forEach((k, idx) => {
      room.colorSelectionMap[k] = { orderNum: orders[idx] || null, selectedBy: null };
    });

    io.to(roomCode).emit('gameStateUpdate', room);
  });

  socket.on('pickColor', ({ roomCode, colorKey }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'COLOR_SELECTION') return;
    
    const target = room.colorSelectionMap[colorKey];
    if (!target || target.selectedBy) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player.turnOrder) return;

    target.selectedBy = player.name;
    player.turnOrder = target.orderNum;
    player.color = COLOR_MAP[colorKey].code;
    player.textColor = COLOR_MAP[colorKey].text;

    const allPicked = room.players.every(p => p.turnOrder !== null);
    if (allPicked) {
      room.players.sort((a, b) => a.turnOrder - b.turnOrder);
      room.state = 'PLAYING';
      room.moneyDeck = shuffle([...BASE_MONEY_DECK]);
      room.casinos = distributeMoneyToCasinos(room.moneyDeck);
      room.currentTurnIndex = 0;

      // 애니메이션 연출 신호 발송
      io.to(roomCode).emit('dealMoneyAnimation');
    }

    io.to(roomCode).emit('gameStateUpdate', room);
  });

  socket.on('rollDice', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'PLAYING') return;

    const turnPlayer = room.players[room.currentTurnIndex];
    if (turnPlayer.id !== socket.id) return;

    turnPlayer.currentRoll = [];
    for (let i = 0; i < turnPlayer.diceCount; i++) {
      turnPlayer.currentRoll.push(Math.floor(Math.random() * 6) + 1);
    }

    io.to(roomCode).emit('gameStateUpdate', room);
  });

  socket.on('placeDice', ({ roomCode, diceValue }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'PLAYING') return;

    const turnPlayer = room.players[room.currentTurnIndex];
    if (turnPlayer.id !== socket.id) return;

    const count = turnPlayer.currentRoll.filter(v => v === diceValue).length;
    if (count === 0) return;

    if (!room.casinos[diceValue].dicePlaced[socket.id]) {
      room.casinos[diceValue].dicePlaced[socket.id] = 0;
    }
    room.casinos[diceValue].dicePlaced[socket.id] += count;
    turnPlayer.diceCount -= count;
    turnPlayer.currentRoll = [];

    let isRoundOver = room.players.every(p => p.diceCount === 0);

    if (isRoundOver) {
      resolveRound(room);
    } else {
      do {
        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
      } while (room.players[room.currentTurnIndex].diceCount === 0);

      io.to(roomCode).emit('gameStateUpdate', room);
    }
  });

  // 정산 화면 완료 버튼 동기화
  socket.on('confirmResult', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    room.readyPlayers.add(socket.id);

    if (room.readyPlayers.size >= room.players.length) {
      startNextRoundProcess(room);
    } else {
      io.to(roomCode).emit('updateConfirmCount', { count: room.readyPlayers.size, total: room.players.length });
    }
  });

  socket.on('nextRound', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    startNextRoundProcess(room);
  });
});

function startNextRoundProcess(room) {
  room.readyPlayers.clear();
  if (room.round >= 4) {
    let winner = room.players[0];
    room.players.forEach(p => {
      if (p.totalMoney > winner.totalMoney) winner = p;
      else if (p.totalMoney === winner.totalMoney && p.cardsWon > winner.cardsWon) winner = p;
    });
    io.to(room.code).emit('roundResolved', { isGameOver: true, winner, players: room.players });
  } else {
    room.round += 1;
    room.players.forEach(p => p.diceCount = 8);
    room.casinos = distributeMoneyToCasinos(room.moneyDeck);
    room.currentTurnIndex = (room.round - 1) % room.players.length;

    io.to(room.code).emit('dealMoneyAnimation');
    io.to(room.code).emit('gameStateUpdate', room);
    io.to(room.code).emit('closeModal');
  }
}

function resolveRound(room) {
  const roundResults = {};
  for (let c = 1; c <= 6; c++) {
    const casino = room.casinos[c];
    const dicePlaced = casino.dicePlaced;
    const counts = {};

    Object.keys(dicePlaced).forEach(pId => {
      const cnt = dicePlaced[pId];
      if (cnt > 0) {
        if (!counts[cnt]) counts[cnt] = [];
        counts[cnt].push(pId);
      }
    });

    const validPlayers = [];
    Object.keys(counts).sort((a,b) => b - a).forEach(cnt => {
      if (counts[cnt].length === 1) {
        validPlayers.push(counts[cnt][0]);
      }
    });

    roundResults[c] = [];
    const bills = [...casino.bills];
    for (let i = 0; i < validPlayers.length && i < bills.length; i++) {
      const pId = validPlayers[i];
      const amount = bills[i];
      const player = room.players.find(p => p.id === pId);
      if (player) {
        player.totalMoney += amount;
        player.cardsWon += 1;
        roundResults[c].push({ playerName: player.name, amount });
      }
    }
  }

  room.readyPlayers.clear();
  io.to(room.code).emit('roundResolved', {
    isGameOver: false,
    round: room.round,
    results: roundResults
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
