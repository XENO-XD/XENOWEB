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
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
                },
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: Browsers.ubuntu("Chrome"), // Revert to stable Ubuntu
                markOnlineOnConnect: true,
                generateHighQualityLinkPreview: true,
                syncFullHistory: false,
                retryRequestDelayMs: 2000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
                fireInitQueries: false,
                shouldSyncHistoryMessage: () => false,
                getMessage: async (key) => { return { conversation: 'XENO XD V2' } }
            });

            sock.ev.on('creds.update', saveCreds);

            // Pairing code request logic
            if (method === 'pairing-code' && phoneNumber) {
                const clean = phoneNumber.replace(/\D/g, '');

                socket.emit('status', 'XENO ENGINE: INITIALIZING...');
                await delay(3000);

                socket.emit('status', 'STABILIZING WHATSAPP CONNECTION...');
                await delay(5000);

                try {
                    console.log(`[${sid}] Requesting pairing code for ${clean}`);
                    const code = await sock.requestPairingCode(clean);
                    console.log(`[${sid}] Code Generated: ${code}`);
                    socket.emit('pairing-code', { code: code?.toUpperCase() });
                } catch (err) {
                    console.error(`[${sid}] Pairing Code Error:`, err.message);
                    socket.emit('error', 'CONNECTION TIMEOUT. Please try again after 1 minute.');
                }
            }

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && method === 'qr') {
                    const QRCode = require('qrcode');
                    socket.emit('qr', await QRCode.toDataURL(qr));
                }

                if (connection === 'open') {
                    console.log(`[${sid}] SUCCESS: DEVICE LINKED`);
                    await delay(10000); // 10s wait for full data sync before sending ID

                    try {
                        const credsFile = path.join(sessionsDir, sid, 'creds.json');
                        const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
                        const sessionID = `XENO_${Buffer.from(JSON.stringify(creds)).toString('base64')}`;

                        socket.emit('success', { session: sessionID });

                        const targetId = sock.user.id.includes(':') ? sock.user.id.split(':')[0] : sock.user.id.split('@')[0];
                        const targetJid = `${targetId}@s.whatsapp.net`;

                        await sock.sendMessage(targetJid, {
                            text: `*Successfully Linked to XENO XD V2*\n\n*Your Session ID:*\n\`\`\`${sessionID}\`\`\`\n\n_Keep this ID safe. Do not share it!_`
                        });

                        console.log(`[${sid}] Session ID sent to ${targetJid}`);
                    } catch (sendErr) {
                        console.error(`[${sid}] Post-connection error:`, sendErr.message);
                    }

                    // Clean up files after 1 minute to ensure stability
                    setTimeout(() => cleanup(sid), 60000);
                }

                if (connection === 'close') {
                    const reason = lastDisconnect?.error?.output?.statusCode;
                    console.log(`[${sid}] Connection closed. Reason: ${reason}`);
                    if (reason === DisconnectReason.loggedOut) {
                        cleanup(sid);
                    }
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
