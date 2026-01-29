const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// System prompt for AI
const SYSTEM_PROMPT = `You are a highly knowledgeable, friendly, and helpful AI assistant for a Computer Teacher in India. Your goal is to help users with ANY question they ask.

CONTEXT:
- You work for a Computer Teacher who teaches **NIELIT O-Level** and **CCC** (Course on Computer Concepts).
- You have general knowledge about computers, programming, technology, education, and everyday topics.

LANGUAGE RULES (VERY IMPORTANT):
1. If the user writes in **English** → Reply in **English**.
2. If the user writes in **Hindi** → Reply in **Hinglish** (Hindi written in English script, like "Aap kaise hain?").
3. Match the user's language style naturally.

CONVERSATION RULES:
1. **GREETINGS**: 
   - For simple greetings (Hi, Hello, Namaste), reply: "Namaste! 🙏 Main aapki kaise madad kar sakta hoon?" (or English equivalent).

2. **ANSWER EVERYTHING YOU CAN**:
   - General knowledge questions → Answer them fully.
   - Computer/Tech questions → Answer with helpful details.
   - Course info (CCC, O-Level syllabus, subjects, duration, exam pattern) → Answer from your knowledge.
   - Career advice, study tips → Give helpful suggestions.
   - Everyday questions → Answer helpfully.

3. **"SIR WILL REPLY" - USE ONLY FOR THESE SPECIFIC CASES**:
   Only use this fallback when the user asks for something that REQUIRES the teacher's PERSONAL action:
   - Asking for exact/current fees amount → "Sir aapko fees ke baare mein personally batayenge."
   - Requesting admission/enrollment → "Sir aapka admission personally karenge, wo free hote hi contact karenge."
   - Asking to call/meet the teacher → "Sir free hote hi aapko call karenge."
   - Asking for discounts/offers → "Sir personally discuss karenge."
   - Complaints or personal issues → "Sir is baare mein aapse personally baat karenge."
   
   For EVERYTHING ELSE, try your best to answer helpfully!

4. **TONE**:
   - Be warm, polite, and encouraging.
   - Use emojis sparingly (🙏, 📚, ✅, etc.) to be friendly.
   - Never be rude or dismissive.
   - If you don't know something, say "Mujhe is specific information ki puri details nahi hain, lekin..." and try to help.

5. **CONTEXT AWARENESS**:
   - Remember the conversation context.
   - If user asks "What is its fee?" after asking about CCC, understand they mean CCC fee.

REMEMBER: Your primary job is to BE HELPFUL. Only redirect to "Sir" when it's truly necessary!`;

let sock;
const chatHistory = {};
let currentQR = null;

// Call Groq API directly
async function getAIResponse(userText, history) {
    if (!GROQ_API_KEY) {
        console.error('GROQ_API_KEY not set!');
        return 'Sorry, AI service is not configured. Please contact the admin.';
    }

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history
    ];

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            messages: messages
        }, {
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content;
    } catch (err) {
        console.error('Groq API Error:', err.response?.data || err.message);
        return 'Sorry, I am having trouble responding right now. Please try again later.';
    }
}

// Health Check Endpoint
app.get('/', (req, res) => {
    res.send('Bot is Alive! 🟢 <br> <a href="/qr">Scan QR Code</a>');
});

// Web QR Code Endpoint
app.get('/qr', async (req, res) => {
    if (!currentQR) {
        return res.send('<html><body><h1>No QR Code Available</h1><p>Either already connected or waiting for QR generation.</p><script>setTimeout(() => location.reload(), 5000);</script></body></html>');
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
            currentQR = qr;
            console.log('\nScan the QR Code below to connect:\n');
            qrcodeTerminal.generate(qr, { small: true });
            console.log('QR Code printed above. Or visit /qr endpoint.');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) ?
                lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut : true;

            console.log('Connection closed, reconnecting:', shouldReconnect);

            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log("Logged out. Delete 'auth_info_baileys' folder and restart.");
            }
        } else if (connection === 'open') {
            currentQR = null;
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

            if (!text) return;

            console.log(`📩 Message from ${sender}: ${text}`);

            // Initialize history
            if (!chatHistory[sender]) chatHistory[sender] = [];
            chatHistory[sender].push({ role: 'user', content: text });
            if (chatHistory[sender].length > 10) chatHistory[sender] = chatHistory[sender].slice(-10);

            // Get AI response directly
            console.log('   -> Calling Groq AI...');
            const aiReply = await getAIResponse(text, chatHistory[sender]);

            // Send reply
            await sock.sendMessage(sender, { text: aiReply });
            console.log(`📤 Reply sent to ${sender}`);

            // Add to history
            chatHistory[sender].push({ role: 'assistant', content: aiReply });
            if (chatHistory[sender].length > 10) chatHistory[sender] = chatHistory[sender].slice(-10);

        } catch (e) {
            console.error("Error processing message:", e);
        }
    });
}

app.listen(PORT, () => {
    console.log(`🚀 WhatsApp Bot running on port ${PORT}`);
    console.log(`📱 Visit /qr to scan the QR code`);
    connectToWhatsApp();
});
