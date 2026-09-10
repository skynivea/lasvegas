const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket', 'polling']
});

app.use(express.static('public'));

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

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function generateRoomCode() {
  let code = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms[code] ? generateRoomCode() : code;
}

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
    room.casinos[c].bills.sort((a, b) => b - a);
  }
}

function startNewRound(room) {
  room.confirmedPlayers.clear();

  if (room.moneyDeck.length < 15) {
    room.moneyDeck = shuffle([...INITIAL_MONEY_DECK]);
  }

  dealMoneyToCasinos(room);

  room.players.forEach(p => {
    p.diceCount = 8;
    p.currentRoll = [];
  });

  room.currentTurnIndex = (room.round - 1) % room.players.length;
  room.currentTurnPlayerId = room.players[room.currentTurnIndex].id;
}

io.on('connection', (socket) => {
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
      state: 'WAITING',
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

  socket.on('joinRoom', ({ name, roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('errorMsg', '존재하지 않는 방 코드입니다.');
    if (room.state !== 'WAITING') return socket.emit('errorMsg', '이미 게임이 진행 중입니다.');
    if (room.players.length >= 4) return socket.emit('errorMsg', '방이 가득 찼습니다.');

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

  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return socket.emit('errorMsg', '최소 2명 이상이어야 시작할 수 있습니다.');

    room.state = 'COLOR_SELECTION';
    io.to(roomCode).emit('gameStateUpdate', room);
  });

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

  socket.on('rollDice', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'PLAYING') return;
    if (room.currentTurnPlayerId !== socket.id) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.diceCount <= 0 || player.currentRoll.length > 0) return;

    io.to(roomCode).emit('playerRolling', { playerId: socket.id, diceCount: player.diceCount });

    player.currentRoll = [];
    for (let i = 0; i < player.diceCount; i++) {
      player.currentRoll.push(Math.floor(Math.random() * 6) + 1);
    }

    io.to(roomCode).emit('gameStateUpdate', room);
  });

  socket.on('placeDice', ({ roomCode, diceValue }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'PLAYING') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || room.currentTurnPlayerId !== socket.id) return;

    const count = player.currentRoll.filter(v => v === diceValue).length;
    if (count === 0) return;

    if (!room.casinos[diceValue].dicePlaced[player.id]) {
      room.casinos[diceValue].dicePlaced[player.id] = 0;
    }
    room.casinos[diceValue].dicePlaced[player.id] += count;

    player.diceCount -= count;
    player.currentRoll = [];

    let nextIdx = (room.currentTurnIndex + 1) % room.players.length;
    let loopCount = 0;

    while (room.players[nextIdx].diceCount === 0 && loopCount < room.players.length) {
      nextIdx = (nextIdx + 1) % room.players.length;
      loopCount++;
    }

    if (loopCount >= room.players.length) {
      resolveRound(roomCode);
    } else {
      room.currentTurnIndex = nextIdx;
      room.currentTurnPlayerId = room.players[nextIdx].id;
      io.to(roomCode).emit('gameStateUpdate', room);
    }
  });

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

  socket.on('confirmResult', ({ roomCode }) => {
    socket.emit('closeModal');
  });

  socket.on('nextRound', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;

    room.round++;
    startNewRound(room);

    io.to(roomCode).emit('closeModal');
    io.to(roomCode).emit('startMoneyDealingSequence');
    io.to(roomCode).emit('gameStateUpdate', room);
  });

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
            room.hostId = room.players[0].id;
          }
          io.to(code).emit('gameStateUpdate', room);
        }
        break;
      }
    }
  });
});

function resolveRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const roundResults = {};

  for (let c = 1; c <= 6; c++) {
    const casino = room.casinos[c];
    roundResults[c] = [];

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
