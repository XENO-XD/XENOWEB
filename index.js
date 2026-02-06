const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pino = require('pino');
const fs = require('fs');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir);

function cleanup(id) {
    const dir = path.join(sessionsDir, id);
    if (fs.existsSync(dir)) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
    }
}

io.on('connection', (socket) => {
    const sid = socket.id;
    let sock = null;

    socket.on('start-pairing', async ({ method, phoneNumber }) => {
        console.log(`[${sid}] New Request: ${method} | Num: ${phoneNumber}`);
        cleanup(sid);

        try {
            const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionsDir, sid));
            const { version } = await fetchLatestBaileysVersion();

            sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
                },
                printQRInTerminal: false,
                logger: pino({ level: 'fatal' }),
                browser: ["XENO XD V2", "Desktop", "1.0.0"],
                markOnlineOnConnect: false
            });

            sock.ev.on('creds.update', saveCreds);

            // Handle pairing code logic ONLY for code method
            if (method === 'pairing-code' && phoneNumber) {
                const clean = phoneNumber.replace(/\D/g, '');

                // Detailed progress to frontend
                socket.emit('status', 'STABILIZING CONNECTION...');
                await delay(3000);

                socket.emit('status', 'REQUESTING 8-DIGIT CODE...');
                await delay(5000); // 8 seconds total delay for maximum stability

                try {
                    console.log(`[${sid}] Sending requestPairingCode for ${clean}`);
                    const code = await sock.requestPairingCode(clean);
                    console.log(`[${sid}] SUCCESS: ${code}`);
                    socket.emit('pairing-code', { code: code?.toUpperCase() });
                } catch (err) {
                    console.error(`[${sid}] Pairing Code Error:`, err);
                    socket.emit('error', 'WHATSAPP REFUSED CODE REQUEST. Please wait 5 minutes and try again.');
                }
            }

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && method === 'qr') {
                    const QRCode = require('qrcode');
                    socket.emit('qr', await QRCode.toDataURL(qr));
                }

                if (connection === 'open') {
                    console.log(`[${sid}] CONNECTION SUCCESSFUL`);
                    const credsFile = path.join(sessionsDir, sid, 'creds.json');
                    const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));

                    // Simple prefix for your bot
                    const sessionID = `XENO_${Buffer.from(JSON.stringify(creds)).toString('base64')}`;

                    socket.emit('success', { session: sessionID });
                    await delay(2000);
                    await sock.sendMessage(sock.user.id, { text: `*XENO XD V2 PAIRED*\n\nYour session ID is:\n\n\`\`\`${sessionID}\`\`\`` });

                    setTimeout(() => cleanup(sid), 10000);
                }

                if (connection === 'close') {
                    const reason = lastDisconnect?.error?.output?.statusCode;
                    console.log(`[${sid}] Closed. Reason: ${reason}`);
                    if (reason === DisconnectReason.loggedOut) cleanup(sid);
                }
            });

        } catch (fatal) {
            console.error('Fatal Init Error:', fatal);
            socket.emit('error', 'INTERNAL SERVER ERROR. PLEASE REFRESH.');
        }
    });

    socket.on('disconnect', () => {
        if (sock) try { sock.end(); } catch (e) { }
    });
});

server.listen(PORT, () => console.log(`XENO SERVER: http://localhost:${PORT}`));
