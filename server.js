const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Almacén simple de estados (en producción usarías algo más robusto)
let games = {}; 

io.on('connection', (socket) => {
    // La TV crea la sala
    socket.on('create-game', () => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        socket.join(roomCode);
        games[roomCode] = { players: [], board: [] };
        socket.emit('game-created', roomCode);
    });

    // El Celular se une a la sala
    socket.on('join-game', (data) => {
        const { roomCode, playerName } = data;
        if (io.sockets.adapter.rooms.has(roomCode)) {
            socket.join(roomCode);
            // Avisar a la TV que alguien se unió
            io.to(roomCode).emit('player-joined', playerName);
            socket.emit('joined-success', { roomCode });
        } else {
            socket.emit('error', 'La sala no existe');
        }
    });

    // El Celular envía una jugada
    socket.on('play-word', (data) => {
        // data: { roomCode, word, x, y, vertical }
        io.to(data.roomCode).emit('new-word-on-board', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
