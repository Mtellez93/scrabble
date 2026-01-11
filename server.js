const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- CONFIGURACIÓN DEL JUEGO ---
const VALORES_LETRAS = {
    'A':1, 'E':1, 'I':1, 'O':1, 'U':1, 'L':1, 'N':1, 'R':1, 'S':1, 'T':1,
    'D':2, 'G':2, 'B':3, 'C':3, 'M':3, 'P':3, 'F':4, 'H':4, 'V':4, 'W':4, 'Y':4,
    'Q':5, 'J':8, 'X':8, 'K':10, 'Z':10
};

const MULTIPLICADORES = {
    "0,0": "TP", "0,7": "TP", "0,14": "TP", "7,0": "TP", "7,14": "TP", "14,0": "TP", "14,7": "TP", "14,14": "TP",
    "1,1": "DP", "2,2": "DP", "3,3": "DP", "4,4": "DP", "1,13": "DP", "2,12": "DP", "3,11": "DP", "4,10": "DP"
};

let diccionario = [];
try {
    const data = fs.readFileSync('./palabras.json', 'utf8');
    diccionario = JSON.parse(data).map(p => p.toUpperCase());
} catch (e) { console.log("Diccionario no cargado, aceptando todo."); }

let games = {};

function generarLetras(n) {
    const bolsa = "AAAAAAAAAEEEEEEEEEEEEIIIIIIIIIOOOOOOOOOUUUUUBBCCDDDDFFGGHHJKLLLLLMMMNNNNNPPPPQRRRRRSSSSSSTTTTTTVVWXYZ";
    return Array.from({length: n}, () => bolsa.charAt(Math.floor(Math.random() * bolsa.length)));
}

io.on('connection', (socket) => {
    socket.on('create-game', () => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        games[roomCode] = { players: {}, turnOrder: [], currentTurnIdx: 0, timeLeft: 60 };
        socket.join(roomCode);
        socket.emit('game-created', roomCode);
    });

    socket.on('join-game', (data) => {
        const { roomCode, playerName } = data;
        const game = games[roomCode];
        if (game) {
            socket.join(roomCode);
            game.players[socket.id] = { id: socket.id, name: playerName, score: 0 };
            game.turnOrder.push(socket.id);
            socket.emit('joined-success', { roomCode, letras: generarLetras(7) });
            io.to(roomCode).emit('update-game-state', {
                players: Object.values(game.players),
                turnOwner: game.turnOrder[game.currentTurnIdx]
            });
        }
    });

    socket.on('play-word', (data) => {
        const game = games[data.roomCode];
        if (!game || game.turnOrder[game.currentTurnIdx] !== socket.id) return;

        const palabra = data.word.toUpperCase();
        if (diccionario.length > 0 && !diccionario.includes(palabra)) {
            return socket.emit('error-juego', 'La palabra no existe');
        }

        // Cálculo de puntos con multiplicadores
        let puntosBase = 0;
        let multiPalabra = 1;
        palabra.split('').forEach((letra, i) => {
            let x = data.vertical ? parseInt(data.x) : parseInt(data.x) + i;
            let y = data.vertical ? parseInt(data.y) + i : parseInt(data.y);
            let m = MULTIPLICADORES[`${x},${y}`];
            let p = VALORES_LETRAS[letra] || 1;
            if (m === "DL") p *= 2;
            if (m === "TL") p *= 3;
            if (m === "DP") multiPalabra *= 2;
            if (m === "TP") multiPalabra *= 3;
            puntosBase += p;
        });

        game.players[socket.id].score += (puntosBase * multiPalabra);
        
        // Siguiente turno
        game.currentTurnIdx = (game.currentTurnIdx + 1) % game.turnOrder.length;
        
        io.to(data.roomCode).emit('new-word-on-board', data);
        
        if (game.players[socket.id].score >= 100) {
            io.to(data.roomCode).emit('game-over', Object.values(game.players).sort((a,b) => b.score - a.score));
        } else {
            io.to(data.roomCode).emit('update-game-state', {
                players: Object.values(game.players),
                turnOwner: game.turnOrder[game.currentTurnIdx]
            });
            socket.emit('nuevas-letras', generarLetras(palabra.length));
        }
    });
});

server.listen(process.env.PORT || 3000, () => console.log('Servidor activo'));
