const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/mobil', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mobil.html'));
});

const VALORES_LETRAS = { 
    'A':1, 'E':1, 'I':1, 'O':1, 'U':1, 'L':1, 'N':1, 'R':1, 'S':1, 'T':1,
    'D':2, 'G':2, 'B':3, 'C':3, 'M':3, 'P':3, 'F':4, 'H':4, 'V':4, 'W':4, 'Y':4,
    'Q':5, 'J':8, 'X':8, 'K':10, 'Z':10 
};

const MULTIPLICADORES = { 
    "0,0": "TP", "0,7": "TP", "0,14": "TP", "7,0": "TP", "7,14": "TP", "14,0": "TP", "14,7": "TP", "14,14": "TP",
    "1,1": "DP", "2,2": "DP", "3,3": "DP", "4,4": "DP", "10,10": "DP", "11,11": "DP", "12,12": "DP", "13,13": "DP"
};

let diccionario = [];
try {
    const data = fs.readFileSync('./palabras.json', 'utf8');
    diccionario = JSON.parse(data).map(p => p.toUpperCase());
} catch (e) { console.log("Diccionario no cargado."); }

let games = {};

function generarLetras(n) {
    const bolsa = "AAAAAAAAAEEEEEEEEEEEEIIIIIIIIIOOOOOOOOOUUUUUBBCCDDDDFFGGHHJKLLLLLMMMNNNNNPPPPQRRRRRSSSSSSTTTTTTVVWXYZ";
    return Array.from({length: n}, () => bolsa.charAt(Math.floor(Math.random() * bolsa.length)));
}

io.on('connection', (socket) => {
    socket.on('create-game', () => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        games[roomCode] = { 
            players: {}, 
            turnOrder: [], 
            currentTurnIdx: 0, 
            board: Array(15).fill(null).map(() => Array(15).fill(null)) 
        };
        socket.join(roomCode);
        socket.emit('game-created', roomCode);
    });

    socket.on('join-game', (data) => {
        const { roomCode, playerName } = data;
        const game = games[roomCode];
        if (game) {
            socket.join(roomCode);
            const letras = generarLetras(7);
            game.players[socket.id] = { id: socket.id, name: playerName, score: 0, letras: letras };
            game.turnOrder.push(socket.id);
            socket.emit('joined-success', { roomCode, letras: letras });
            io.to(roomCode).emit('update-game-state', { players: Object.values(game.players), turnOwner: game.turnOrder[game.currentTurnIdx] });
        }
    });

    socket.on('pass-turn', (roomCode) => {
        const game = games[roomCode];
        if (!game || game.turnOrder[game.currentTurnIdx] !== socket.id) return;

        const player = game.players[socket.id];
        
        // Límite de 12 fichas
        if (player.letras.length < 12) {
            const nuevaFicha = generarLetras(1);
            player.letras.push(...nuevaFicha);
        }

        game.currentTurnIdx = (game.currentTurnIdx + 1) % game.turnOrder.length;

        socket.emit('nuevas-letras', player.letras);
        io.to(roomCode).emit('update-game-state', { 
            players: Object.values(game.players), 
            turnOwner: game.turnOrder[game.currentTurnIdx] 
        });
        io.to(roomCode).emit('player-passed', player.name);
    });

    socket.on('play-word', (data) => {
        const game = games[data.roomCode];
        if (!game || game.turnOrder[game.currentTurnIdx] !== socket.id) return;

        const palabraArr = data.word.toUpperCase().trim().split('');
        const player = game.players[socket.id];

        if (diccionario.length > 0 && !diccionario.includes(data.word.toUpperCase())) {
            return socket.emit('error-juego', 'La palabra no existe.');
        }

        let atrilTemp = [...player.letras];
        let letrasNuevasColocadas = 0;
        let letrasUsadasDelAtril = [];

        for (let i = 0; i < palabraArr.length; i++) {
            let x = data.vertical ? parseInt(data.x) : parseInt(data.x) + i;
            let y = data.vertical ? parseInt(data.y) + i : parseInt(data.y);
            let letraDeseada = palabraArr[i];
            if (x > 14 || y > 14 || x < 0 || y < 0) return socket.emit('error-juego', 'Fuera del tablero');

            let letraEnTablero = game.board[y][x];
            if (letraEnTablero !== null) {
                if (letraEnTablero !== letraDeseada) return socket.emit('error-juego', `Choque en columna ${x}, renglón ${y}`);
            } else {
                const idx = atrilTemp.indexOf(letraDeseada);
                if (idx > -1) {
                    atrilTemp.splice(idx, 1);
                    letrasUsadasDelAtril.push(letraDeseada);
                    letrasNuevasColocadas++;
                } else {
                    return socket.emit('error-juego', `No tienes la letra ${letraDeseada}`);
                }
            }
        }

        if (letrasNuevasColocadas === 0) return socket.emit('error-juego', 'Debes colocar al menos una letra nueva');

        let puntosBase = 0;
        let multiPalabra = 1;
        palabraArr.forEach((letra, i) => {
            let x = data.vertical ? parseInt(data.x) : parseInt(data.x) + i;
            let y = data.vertical ? parseInt(data.y) + i : parseInt(data.y);
            game.board[y][x] = letra;
            let m = MULTIPLICADORES[`${x},${y}`];
            let p = VALORES_LETRAS[letra] || 1;
            if (m === "DL") p *= 2; if (m === "TL") p *= 3;
            if (m === "DP") multiPalabra *= 2; if (m === "TP") multiPalabra *= 3;
            puntosBase += p;
        });

        let total = puntosBase * multiPalabra;
        if (letrasUsadasDelAtril.length === 7) total += 50;

        player.score += total;
        player.letras = [...atrilTemp, ...generarLetras(letrasUsadasDelAtril.length)];
        game.currentTurnIdx = (game.currentTurnIdx + 1) % game.turnOrder.length;

        io.to(data.roomCode).emit('new-word-on-board', { ...data, bingo: letrasUsadasDelAtril.length === 7, puntosTurno: total });
        io.to(data.roomCode).emit('update-game-state', { players: Object.values(game.players), turnOwner: game.turnOrder[game.currentTurnIdx] });
        socket.emit('nuevas-letras', player.letras);
    });
});

server.listen(process.env.PORT || 3000, () => console.log('Servidor Scrabble Online'));
