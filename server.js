const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));

const queue = []; // { ws, name }
const rooms = {}; // gameId -> { p1, p2, state, p1Name, p2Name }

function generateId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function send(ws, msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
    ws.isGameConnection = false;

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        if (msg.type === 'join') {
            const playerName = String(msg.playerName || 'Player').substring(0, 20);
            if (queue.length > 0) {
                const opponent = queue.shift();
                const gameId = generateId();
                rooms[gameId] = { p1: opponent.ws, p2: ws, state: null, p1Name: opponent.name, p2Name: playerName };
                opponent.ws.gameId = gameId;
                ws.gameId = gameId;
                send(opponent.ws, { type: 'matched', playerNum: 1, gameId, myName: opponent.name, opponentName: playerName });
                send(ws, { type: 'matched', playerNum: 2, gameId, myName: playerName, opponentName: opponent.name });
            } else {
                ws.playerName = playerName;
                queue.push({ ws, name: playerName });
                send(ws, { type: 'waiting' });
            }
        }

        if (msg.type === 'register') {
            ws.isGameConnection = true;
            ws.gameId = msg.gameId;
            ws.playerNum = msg.playerNum;
            const room = rooms[msg.gameId];
            if (!room) {
                send(ws, { type: 'error', message: 'Room not found. Return to lobby.' });
                return;
            }
            if (msg.playerNum === 1) room.p1 = ws;
            else room.p2 = ws;
            send(ws, { type: 'registered' });
            // Send stored state if player 2 joins after player 1 already initialized
            if (room.state) {
                send(ws, { type: 'state', state: room.state });
            }
        }

        if (msg.type === 'state') {
            const room = rooms[msg.gameId];
            if (!room) return;
            room.state = msg.state;
            const other = room.p1 === ws ? room.p2 : room.p1;
            send(other, { type: 'state', state: msg.state });
        }
    });

    ws.on('close', () => {
        // Remove from matchmaking queue if still waiting
        const qi = queue.findIndex(q => q.ws === ws);
        if (qi !== -1) queue.splice(qi, 1);

        // Only notify partner if this was an active game connection
        if (!ws.isGameConnection || !ws.gameId) return;
        const room = rooms[ws.gameId];
        if (!room) return;
        const other = room.p1 === ws ? room.p2 : room.p1;
        send(other, { type: 'opponent_disconnected' });
        delete rooms[ws.gameId];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
