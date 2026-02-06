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
                browser: Browsers.macOS("Desktop"),
                markOnlineOnConnect: false,
                syncFullHistory: false
            });

            sock.ev.on('creds.update', saveCreds);

            // Pairing code request
            if (method === 'pairing-code' && phoneNumber) {
                const clean = phoneNumber.replace(/\D/g, '');

                socket.emit('status', 'STABILIZING WHATSAPP SERVER...');
                await delay(5000); // 5s stabilization is safer

                try {
                    console.log(`[${sid}] Attempting pairing code for: ${clean}`);
                    socket.emit('status', 'REQUESTING CODE FROM WHATSAPP...');

                    const code = await sock.requestPairingCode(clean);
                    console.log(`[${sid}] Pairing Code Generated: ${code}`);

                    if (code) {
                        socket.emit('pairing-code', { code: code.toUpperCase() });
                    } else {
                        throw new Error("EMPTY_CODE");
                    }
                } catch (err) {
                    console.error(`[${sid}] Pairing Code Failed:`, err.message);
                    let errorMsg = 'WHATSAPP REFUSED REQUEST. Try again in 2 minutes.';
                    if (err.message?.includes('429')) errorMsg = 'TOO MANY REQUESTS. Please wait 10 minutes.';
                    socket.emit('error', errorMsg);
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
                    await delay(5000); // Wait for metadata stabilization

                    try {
                        const credsFile = path.join(sessionsDir, sid, 'creds.json');
                        const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
                        const sessionID = `XENO_${Buffer.from(JSON.stringify(creds)).toString('base64')}`;

                        socket.emit('success', { session: sessionID });

                        // Ensure target JID is clean (remove device/session suffix)
                        const targetId = sock.user.id.includes(':') ? sock.user.id.split(':')[0] : sock.user.id.split('@')[0];
                        const targetJid = `${targetId}@s.whatsapp.net`;

                        await sock.sendMessage(targetJid, {
                            text: `*XENO XD V2 PAIRED SUCCESSFULLY*\n\n*Session ID:*\n\`\`\`${sessionID}\`\`\`\n\n_Do not share this code with anyone!_`
                        });

                        console.log(`[${sid}] Session ID sent to ${targetJid}`);
                    } catch (sendErr) {
                        console.error(`[${sid}] Error sending session ID:`, sendErr);
                    }

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
