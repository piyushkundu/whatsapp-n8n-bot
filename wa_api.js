const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode'); // Re-added for Web View
// ...

let sock;
const chatHistory = {};
let currentQR = null; // Store QR for Web View

// Health Check Endpoint
app.get('/', (req, res) => {
    res.send('Bot is Alive! 🟢 <br> <a href="/qr">Scan QR Code</a>');
});

// Web QR Code Endpoint
app.get('/qr', async (req, res) => {
    if (!currentQR) {
        return res.send('<html><body><h1>No QR Code Generated Yet</h1><p>Wait for a few seconds or check if already connected.</p><script>setTimeout(() => location.reload(), 5000);</script></body></html>');
    }
    try {
        const url = await QRCode.toDataURL(currentQR);
        res.send(`<html><body style="text-align:center; padding-top:50px;">
            <h1>Scan this QR Code</h1>
            <img src="${url}" style="width:300px; height:300px; border:1px solid #ccc;"/>
            <p>Reloading in 5 seconds...</p>
            <script>setTimeout(() => location.reload(), 5000);</script>
        </body></html>`);
    } catch (err) {
        res.status(500).send('Error generating QR');
    }
});

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Windows", "Chrome", "10.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr; // Save for Web View
            console.log('\nScan the QR Code below to connect:\n');
            qrcodeTerminal.generate(qr, { small: true });
            console.log('QR Code printed above. Please scan it with WhatsApp.');
        }

        if (connection === 'open') {
            currentQR = null; // Clear QR on connection
            console.log('✅ WhatsApp Connected!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m.message) return;
            if (m.key.fromMe) return;

            const sender = m.key.remoteJid;
            const messageType = Object.keys(m.message)[0];
            let text = '';

            if (messageType === 'conversation') {
                text = m.message.conversation;
            } else if (messageType === 'extendedTextMessage') {
                text = m.message.extendedTextMessage.text;
            }

            console.log(`📩 New Message from ${sender}: ${text}`);

            // Initialize history if needed
            if (!chatHistory[sender]) chatHistory[sender] = [];

            // Add User Message
            chatHistory[sender].push({ role: 'user', content: text });

            // Limit history (Keep last 10 messages)
            if (chatHistory[sender].length > 10) chatHistory[sender] = chatHistory[sender].slice(-10);

            // Forward to n8n with History
            if (text) {
                try {
                    await axios.post(N8N_WEBHOOK_URL, {
                        senderId: sender,
                        userText: text,
                        name: m.pushName || "User",
                        history: chatHistory[sender]
                    });
                    console.log('   -> Forwarded to n8n');
                } catch (err) {
                    console.error('   ❌ Failed to send to n8n:', err.message);
                }
            }
        } catch (e) {
            console.error("Error processing message:", e);
        }
    });
}

// Health Check Endpoint (For UptimeRobot)
app.get('/', (req, res) => {
    res.send('Bot is Alive! 🟢');
});

// API to Send Message (Called by n8n)
app.post('/send', async (req, res) => {
    const { senderId, text } = req.body;

    if (!senderId || !text) {
        return res.status(400).json({ error: 'Missing senderId or text' });
    }

    try {
        await sock.sendMessage(senderId, { text: text });
        console.log(`📤 Reply sent to ${senderId}`);

        // Add Assistant Message to History
        if (!chatHistory[senderId]) chatHistory[senderId] = [];
        chatHistory[senderId].push({ role: 'assistant', content: text });
        // Limit history
        if (chatHistory[senderId].length > 10) chatHistory[senderId] = chatHistory[senderId].slice(-10);

        res.json({ status: 'success' });
    } catch (err) {
        console.error('Failed to send:', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Bridge API running on port ${PORT}`);
    connectToWhatsApp();
});
