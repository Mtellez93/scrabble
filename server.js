const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const VALORES_LETRAS = { 'A':1, 'E':1, 'I':1, 'O':1, 'U':1, 'L':1, 'N':1, 'R':1, 'S':1, 'T':1, 'D':2, 'G':2, 'B':3, 'C':3, 'M':3, 'P':3, 'F':4, 'H':4, 'V':4, 'W':4, 'Y':4, 'Q':5, 'J':8, 'X':8, 'K':10, 'Z':10 };
const MULTIPLICADORES = { "0,0": "TP", "0,7": "TP", "0,14": "TP", "7,0": "TP", "7,14": "TP", "14,0": "TP", "14,7": "TP", "14,14": "TP", "1,1": "DP", "2,2": "DP", "3,3": "DP", "4,4": "DP" };

let diccionario = [];
try {
    diccionario = JSON.parse(fs.readFileSync('./palabras.json', 'utf8')).map(p => p.toUpperCase());
} catch (e) { console.log("Diccionario no cargado."); }

let games = {};

function generarLetras(n) {
    const bolsa = "AAAAAAAAAEEEEEEEEEEEEIIIIIIIIIOOOOOOOOOUUUUUBBCCDDDDFFGGHHJKLLLLLMMMNNNNNPPPPQRRRRRSSSSSSTTTTTTVVWXYZ";
    return Array.from({length: n}, () => bolsa.charAt(Math.floor(Math.random() * bolsa.length)));
}

io.on('connection', (socket) => {
    socket.on('create-game', () => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        games[roomCode] = { players: {}, turnOrder: [], currentTurnIdx: 0, board: Array(15).fill(null).map(() => Array(15).fill(null)) };
        socket.join(roomCode);
        socket.emit('game-created', roomCode);
    });

    socket.on('join-game', (data) => {
        const { roomCode, playerName } = data;
        const game = games[roomCode];
        if (game) {
            socket.join(roomCode);
            const iniciales = generarLetras(7);
            game.players[socket.id] = { id: socket.id, name: playerName, score: 0, letras: iniciales };
            game.turnOrder.push(socket.id);
            socket.emit('joined-success', { roomCode, letras: iniciales });
            io.to(roomCode).emit('update-game-state', { players: Object.values(game.players), turnOwner: game.turnOrder[game.currentTurnIdx] });
        }
    });

    socket.on('play-word', (data) => {
        const game = games[data.roomCode];
        if (!game || game.turnOrder[game.currentTurnIdx] !== socket.id) return;

        const palabraArr = data.word.toUpperCase().split('');
        const player = game.players[socket.id];

        // 1. VALIDAR DICCIONARIO
        if (diccionario.length > 0 && !diccionario.includes(data.word.toUpperCase())) return socket.emit('error-juego', 'Palabra no válida');

        // 2. VALIDAR LETRAS EN ATRIL
        let atrilTemp = [...player.letras];
        let letrasValidas = palabraArr.every(l => {
            const i = atrilTemp.indexOf(l);
            if (i > -1) { atrilTemp.splice(i, 1); return true; }
            return false;
        });
        if (!letrasValidas) return socket.emit('error-juego', 'No tienes esas letras');

        // 3. VALIDAR ESPACIO Y COLISIONES
        for (let i = 0; i < palabraArr.length; i++) {
            let x = data.vertical ? parseInt(data.x) : parseInt(data.x) + i;
            let y = data.vertical ? parseInt(data.y) + i : parseInt(data.y);
            if (x > 14 || y > 14 || game.board[y][x] !== null) return socket.emit('error-juego', 'Casilla ocupada o fuera de rango');
        }

        // 4. CALCULAR PUNTOS
        let puntos = 0, multiP = 1;
        palabraArr.forEach((l, i) => {
            let x = data.vertical ? parseInt(data.x) : parseInt(data.x) + i;
            let y = data.vertical ? parseInt(data.y) + i : parseInt(data.y);
            game.board[y][x] = l;
            let m = MULTIPLICADORES[`${x},${y}`], p = VALORES_LETRAS[l] || 1;
            if (m === "DL") p *= 2; if (m === "TL") p *= 3;
            if (m === "DP") multiP *= 2; if (m === "TP") multiP *= 3;
            puntos += p;
        });
        
        let total = (puntos * multiP);
        if (palabraArr.length === 7) total += 50; // ¡BINGO!

        player.score += total;
        player.letras = [...atrilTemp, ...generarLetras(palabraArr.length)];
        game.currentTurnIdx = (game.currentTurnIdx + 1) % game.turnOrder.length;

        io.to(data.roomCode).emit('new-word-on-board', { ...data, bingo: palabraArr.length === 7 });
        io.to(data.roomCode).emit('update-game-state', { players: Object.values(game.players), turnOwner: game.turnOrder[game.currentTurnIdx] });
        socket.emit('nuevas-letras', player.letras);
    });
});

server.listen(process.env.PORT || 3000, () => console.log('Server Ready'));
