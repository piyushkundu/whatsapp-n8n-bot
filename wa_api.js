const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const qrcodeTerminal = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const N8N_WEBHOOK_URL = 'http://127.0.0.1:5678/webhook/whatsapp';

let sock;
const chatHistory = {};

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // We use qrcode-terminal manually
        logger: pino({ level: 'silent' }),
        browser: ["Windows", "Chrome", "10.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\nScan the QR Code below to connect:\n');
            qrcodeTerminal.generate(qr, { small: true });
            console.log('QR Code printed above. Please scan it with WhatsApp.');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) ?
                lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut : true;

            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting: ', shouldReconnect);

            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log("Logged out. Delete 'auth_info_baileys' folder and restart to scan again.");
            }
        } else if (connection === 'open') {
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
