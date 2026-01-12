const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Ruta amigable para los celulares
app.get('/mobil', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mobil.html'));
});

// --- CONFIGURACIÓN DE PUNTUACIÓN ---
const VALORES_LETRAS = { 
    'A':1, 'E':1, 'I':1, 'O':1, 'U':1, 'L':1, 'N':1, 'R':1, 'S':1, 'T':1,
    'D':2, 'G':2, 'B':3, 'C':3, 'M':3, 'P':3, 'F':4, 'H':4, 'V':4, 'W':4, 'Y':4,
    'Q':5, 'J':8, 'X':8, 'K':10, 'Z':10 
};

// Mapa de multiplicadores (Coordenadas X,Y)
const MULTIPLICADORES = { 
    "0,0": "TP", "0,7": "TP", "0,14": "TP", "7,0": "TP", "7,14": "TP", "14,0": "TP", "14,7": "TP", "14,14": "TP",
    "1,1": "DP", "2,2": "DP", "3,3": "DP", "4,4": "DP", "10,10": "DP", "11,11": "DP", "12,12": "DP", "13,13": "DP"
};

// Carga del diccionario
let diccionario = [];
try {
    const data = fs.readFileSync('./palabras.json', 'utf8');
    diccionario = JSON.parse(data).map(p => p.toUpperCase());
    console.log("Diccionario cargado correctamente.");
} catch (e) {
    console.log("Error: No se encontró palabras.json. Se aceptarán todas las palabras.");
}

let games = {};

function generarLetras(n) {
    const bolsa = "AAAAAAAAAEEEEEEEEEEEEIIIIIIIIIOOOOOOOOOUUUUUBBCCDDDDFFGGHHJKLLLLLMMMNNNNNPPPPQRRRRRSSSSSSTTTTTTVVWXYZ";
    return Array.from({length: n}, () => bolsa.charAt(Math.floor(Math.random() * bolsa.length)));
}

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

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
            const letrasIniciales = generarLetras(7);
            game.players[socket.id] = { 
                id: socket.id, 
                name: playerName, 
                score: 0, 
                letras: letrasIniciales 
            };
            game.turnOrder.push(socket.id);
            
            socket.emit('joined-success', { roomCode, letras: letrasIniciales });
            
            io.to(roomCode).emit('update-game-state', { 
                players: Object.values(game.players), 
                turnOwner: game.turnOrder[game.currentTurnIdx] 
            });
        } else {
            socket.emit('error-juego', 'La sala no existe.');
        }
    });

    socket.on('play-word', (data) => {
        const game = games[data.roomCode];
        if (!game || game.turnOrder[game.currentTurnIdx] !== socket.id) {
            return socket.emit('error-juego', 'No es tu turno.');
        }

        const palabraArr = data.word.toUpperCase().trim().split('');
        const player = game.players[socket.id];

        if (palabraArr.length < 2) return socket.emit('error-juego', 'Mínimo 2 letras.');

        // 1. Validar Diccionario
        if (diccionario.length > 0 && !diccionario.includes(data.word.toUpperCase())) {
            return socket.emit('error-juego', 'Esa palabra no existe en el diccionario.');
        }

        // 2. Validar que el jugador tiene las letras en su atril
        let atrilTemp = [...player.letras];
        let letrasValidas = palabraArr.every(l => {
            const idx = atrilTemp.indexOf(l);
            if (idx > -1) {
                atrilTemp.splice(idx, 1);
                return true;
            }
            return false;
        });

        if (!letrasValidas) return socket.emit('error-juego', 'No tienes las letras necesarias en tu atril.');

        // 3. Validar espacio en el tablero y colisiones
        for (let i = 0; i < palabraArr.length; i++) {
            let x = data.vertical ? parseInt(data.x) : parseInt(data.x) + i;
            let y = data.vertical ? parseInt(data.y) + i : parseInt(data.y);
            
            if (x < 0 || x > 14 || y < 0 || y > 14) return socket.emit('error-juego', 'La palabra se sale del tablero.');
            if (game.board[y][x] !== null) return socket.emit('error-juego', `La casilla (${x},${y}) ya está ocupada.`);
        }

        // 4. Calcular puntos y actualizar tablero
        let puntosBase = 0;
        let multiPalabra = 1;

        palabraArr.forEach((letra, i) => {
            let x = data.vertical ? parseInt(data.x) : parseInt(data.x) + i;
            let y = data.vertical ? parseInt(data.y) + i : parseInt(data.y);
            
            game.board[y][x] = letra; // Guardar en el estado del servidor
            
            let m = MULTIPLICADORES[`${x},${y}`];
            let p = VALORES_LETRAS[letra] || 1;

            if (m === "DL") p *= 2;
            if (m === "TL") p *= 3;
            if (m === "DP") multiPalabra *= 2;
            if (m === "TP") multiPalabra *= 3;

            puntosBase += p;
        });

        let totalTurno = (puntosBase * multiPalabra);
        if (palabraArr.length === 7) totalTurno += 50; // Bono Bingo

        // Actualizar jugador
        player.score += totalTurno;
        player.letras = [...atrilTemp, ...generarLetras(palabraArr.length)];

        // Cambiar turno
        game.currentTurnIdx = (game.currentTurnIdx + 1) % game.turnOrder.length;

        // Notificar a la TV
        io.to(data.roomCode).emit('new-word-on-board', { 
            ...data, 
            bingo: palabraArr.length === 7,
            puntosTurno: totalTurno
        });

        // Actualizar todos los estados
        io.to(data.roomCode).emit('update-game-state', { 
            players: Object.values(game.players), 
            turnOwner: game.turnOrder[game.currentTurnIdx] 
        });

        // Enviar nuevas letras solo al jugador
        socket.emit('nuevas-letras', player.letras);
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor Scrabble corriendo en puerto ${PORT}`));
