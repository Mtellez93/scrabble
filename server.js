 const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('Alguien se conectó:', socket.id);

    // Unirse a una sala específica
    socket.on('join-room', (roomCode) => {
        socket.join(roomCode);
        console.log(`Usuario unido a sala: ${roomCode}`);
    });

    // Escuchar cuando un jugador envía una palabra
    socket.on('enviar-palabra', (data) => {
        // data contiene: { roomCode, palabra, coords, orientacion }
        // Lo enviamos SOLO a la TV de esa sala
        io.to(data.roomCode).emit('actualizar-tablero', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
