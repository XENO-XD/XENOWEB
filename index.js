const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Helper function to clean up session folder
function cleanupSession(id) {
    const sessionPath = path.join(__dirname, 'sessions', id);
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
    }
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    let sock = null;
    const sessionId = socket.id;

    socket.on('start-pairing', async (data) => {
        const { method, phoneNumber } = data;
        console.log(`Starting ${method} pairing for ${sessionId}`);

        cleanupSession(sessionId);
        const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'sessions', sessionId));

        sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
            },
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }),
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        if (method === 'pairing-code' && phoneNumber) {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    socket.emit('pairing-code', { code });
                } catch (err) {
                    console.error('Error requesting pairing code:', err);
                    socket.emit('error', 'Failed to generate pairing code. Make sure the number is correct.');
                }
            }, 3000);
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr && method === 'qr') {
                const qrDataURL = await QRCode.toDataURL(qr);
                socket.emit('qr', qrDataURL);
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Connection closed. Reconnect:', shouldReconnect);
                if (!shouldReconnect) {
                    socket.emit('error', 'Connection closed by WhatsApp.');
                    cleanupSession(sessionId);
                }
            } else if (connection === 'open') {
                console.log('Connection opened!');

                // Get the session string (creds.json)
                const credsFile = path.join(__dirname, 'sessions', sessionId, 'creds.json');
                if (fs.existsSync(credsFile)) {
                    const credsContent = fs.readFileSync(credsFile, 'utf-8');
                    const sessionString = Buffer.from(credsContent).toString('base64');

                    socket.emit('success', {
                        message: 'Connected successfully!',
                        session: sessionString
                    });

                    // Send a message to the user with the session
                    await delay(5000);
                    try {
                        const userJid = jidNormalizedUser(sock.user.id);
                        await sock.sendMessage(userJid, { text: `*XENO XD V2 SESSION CONNECTED*\n\nYour session ID is:\n\n\`\`\`${sessionString}\`\`\`\n\nKeep this safe!` });
                    } catch (e) {
                        console.error('Failed to send session message:', e);
                    }

                    // Cleanup session after success to avoid lingering data
                    // Wait a bit to ensure everything is sent
                    setTimeout(() => {
                        sock.logout();
                        cleanupSession(sessionId);
                    }, 5000);
                }
            }
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        if (sock) {
            try { sock.logout(); } catch (e) { }
        }
        cleanupSession(sessionId);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!fs.existsSync(path.join(__dirname, 'sessions'))) {
        fs.mkdirSync(path.join(__dirname, 'sessions'));
    }
});
