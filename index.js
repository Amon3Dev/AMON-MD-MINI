const express = require("express");
const path = require("path");
const config = require("./config.json");
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    makeCacheableSignalKeyStore,
    Browsers 
} = require("@whiskeysockets/baileys");
const pino = require("pino");

const app = express();
const PORT = process.env.PORT || 10000;

// Store active sockets
const activeSockets = new Map();

const startServer = (marcoInstance) => {
    
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    app.get('/pair', async (req, res) => {
        const num = req.query.number;
        
        if (!num) return res.status(400).json({ error: "Phone number required" });
        
        const sanitizedNumber = num.replace(/[^0-9]/g, '');
        
        // Check if already connected
        if (activeSockets.has(sanitizedNumber)) {
            return res.status(200).json({ 
                success: true, 
                message: "Already connected!",
                alreadyConnected: true
            });
        }

        try {
            const sessionPath = path.join(__dirname, `session_${sanitizedNumber}`);
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            
            const sock = makeWASocket({
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
                },
                browser: Browsers.macOS('Safari')
            });

            // Request pairing code if not registered
            if (!sock.authState.creds.registered) {
                const code = await sock.requestPairingCode(sanitizedNumber);
                
                // Send response immediately with the code
                res.status(200).json({ 
                    success: true, 
                    code: code,
                    message: "Enter this code in WhatsApp > Linked Devices > Link with phone number"
                });
            } else {
                res.status(200).json({ 
                    success: true, 
                    message: "Already registered!",
                    alreadyRegistered: true
                });
            }

            // Handle credentials update (successful pairing)
            sock.ev.on('creds.update', async () => {
                await saveCreds();
                console.log(`✅ Credentials saved for ${sanitizedNumber}`);
                activeSockets.set(sanitizedNumber, sock);
            });

            // Handle connection update
            sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect } = update;
                if (connection === 'open') {
                    console.log(`✅ Bot connected successfully for ${sanitizedNumber}`);
                    activeSockets.set(sanitizedNumber, sock);
                } else if (connection === 'close') {
                    activeSockets.delete(sanitizedNumber);
                    console.log(`❌ Connection closed for ${sanitizedNumber}`);
                }
            });

        } catch (err) {
            console.error("Pairing Error:", err);
            if (!res.headersSent) {
                res.status(500).json({ error: "Failed to generate code: " + err.message });
            }
        }
    });

    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🌍 Server > ${config.botName} online on port ${PORT}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`❌ Port ${PORT} occupied. Immediate shutdown to force Render to restart cleanly.`);
            process.exit(1);
        }
    });
};

module.exports = { startServer };
