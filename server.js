const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/mobil', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mobil.html')));

const VALORES_LETRAS = { 'A':1,'E':1,'I':1,'O':1,'U':1,'L':1,'N':1,'R':1,'S':1,'T':1,'D':2,'G':2,'B':3,'C':3,'M':3,'P':3,'F':4,'H':4,'V':4,'W':4,'Y':4,'Q':5,'J':8,'X':8,'K':10,'Z':10 };
let games = {};
const TIEMPO_TURNO = 60; 
const PUNTOS_PARA_GANAR = 100;

function generarLetras(n) {
    const bolsa = "AAAAAAAAAEEEEEEEEEEEEIIIIIIIIIOOOOOOOOOUUUUUBBCCDDDDFFGGHHJKLLLLLMMMNNNNNPPPPQRRRRRSSSSSSTTTTTTVVWXYZ";
    return Array.from({length: n}, () => bolsa.charAt(Math.floor(Math.random() * bolsa.length)));
}

function startTimer(roomCode) {
    const game = games[roomCode];
    if (!game || game.gameOver) return;
    if (game.timerInterval) clearInterval(game.timerInterval);
    game.timeLeft = TIEMPO_TURNO;
    game.timerInterval = setInterval(() => {
        game.timeLeft--;
        io.to(roomCode).emit('timer-update', game.timeLeft);
        if (game.timeLeft <= 0) {
            clearInterval(game.timerInterval);
            forcePass(roomCode);
        }
    }, 1000);
}

function forcePass(roomCode) {
    const game = games[roomCode];
    if (!game) return;
    game.currentTurnIdx = (game.currentTurnIdx + 1) % game.turnOrder.length;
    io.to(roomCode).emit('update-game-state', { players: Object.values(game.players), turnOwner: game.turnOrder[game.currentTurnIdx] });
    startTimer(roomCode);
}

io.on('connection', (socket) => {
    socket.on('create-game', () => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        games[roomCode] = { players:{}, turnOrder:[], currentTurnIdx:0, board:Array(15).fill(null).map(()=>Array(15).fill(null)), gameOver:false };
        socket.join(roomCode);
        socket.emit('game-created', roomCode);
    });

    socket.on('join-game', (data) => {
        const game = games[data.roomCode];
        if (game) {
            socket.join(data.roomCode);
            game.players[socket.id] = { id:socket.id, name:data.playerName, score:0, letras:generarLetras(7) };
            game.turnOrder.push(socket.id);
            socket.emit('joined-success', { roomCode: data.roomCode, letras: game.players[socket.id].letras });
            io.to(data.roomCode).emit('update-game-state', { players: Object.values(game.players), turnOwner: game.turnOrder[game.currentTurnIdx] });
            if (game.turnOrder.length === 1) startTimer(data.roomCode);
        }
    });

    socket.on('play-word', (data) => {
        const game = games[data.roomCode];
        if (!game || game.turnOrder[game.currentTurnIdx] !== socket.id) return;

        const startX = data.col.charCodeAt(0) - 65;
        const startY = parseInt(data.row);
        const word = data.word.toUpperCase();
        const vertical = data.vertical === true || data.vertical === "true";
        
        let total = 0;
        for (let i = 0; i < word.length; i++) {
            let x = vertical ? startX : startX + i;
            let y = vertical ? startY + i : startY;
            if (x > 14 || y > 14) return socket.emit('error-juego', 'Fuera de rango');
            game.board[y][x] = word[i];
            total += VALORES_LETRAS[word[i]] || 1;
        }

        const player = game.players[socket.id];
        player.score += total;
        player.letras = generarLetras(7);

        if (player.score >= PUNTOS_PARA_GANAR) {
            game.gameOver = true;
            io.to(data.roomCode).emit('game-over', { winner: player.name, finalScore: player.score });
        } else {
            game.currentTurnIdx = (game.currentTurnIdx + 1) % game.turnOrder.length;
            socket.emit('nuevas-letras', player.letras);
            io.to(data.roomCode).emit('new-word-on-board', { word, x: startX, y: startY, vertical, puntosTurno: total });
            io.to(data.roomCode).emit('update-game-state', { players: Object.values(game.players), turnOwner: game.turnOrder[game.currentTurnIdx] });
            startTimer(data.roomCode);
        }
    });

    socket.on('pass-turn', (roomCode) => {
        forcePass(roomCode);
    });
});
server.listen(3000, () => console.log('Servidor Scrabble Listo'));
