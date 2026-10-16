const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const cheerio = require('cheerio');

const chatHistory = {};
const chatTimers = {};

async function unlimitedAIChat(prompt, chatId = null, systemPrompt = null) {
    const crypto = require('crypto');
    const finalChatId = chatId || crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    
    if (!chatHistory[finalChatId]) {
        chatHistory[finalChatId] = [];
    }
    
    if (chatTimers[finalChatId]) {
        clearTimeout(chatTimers[finalChatId]);
    }
    
    chatTimers[finalChatId] = setTimeout(() => {
        delete chatHistory[finalChatId];
        delete chatTimers[finalChatId];
    }, 3 * 60 * 1000);
    
    const messages = [];
    
    if (systemPrompt && !chatHistory[finalChatId].some(m => m.role === 'system')) {
        messages.push({
            "id": crypto.randomUUID(),
            "role": "system",
            "content": systemPrompt,
            "parts": [{
                "type": "text",
                "text": systemPrompt
            }],
            "createdAt": new Date().toISOString()
        });
    }
    
    if (chatHistory[finalChatId]) {
        messages.push(...chatHistory[finalChatId]);
    }
    
    const userMessage = {
        "id": crypto.randomUUID(),
        "role": "user",
        "content": prompt,
        "parts": [{
            "type": "text",
            "text": prompt
        }],
        "createdAt": new Date().toISOString()
    };
    
    messages.push(userMessage);
    
    const payload = {
        "chatId": finalChatId,
        "messages": messages,
        "selectedChatModel": "chat-model-reasoning",
        "selectedCharacter": null,
        "selectedStory": null,
        "deviceId": deviceId,
        "locale": "id"
    };

    const headers = {
        'Content-Type': 'application/json',
        'x-next-intl-locale': 'id',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'
    };

    const response = await axios.post('https://app.unlimitedai.chat/api/chat', payload, {
        headers: headers,
        timeout: 60000,
        responseType: 'stream'
    });

    let responseText = '';
    
    return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const data = JSON.parse(line);
                        if (data.type === 'delta' && data.delta) {
                            responseText += data.delta;
                        }
                    } catch (e) {}
                }
            }
        });

        response.data.on('end', () => {
            const assistantResponse = {
                "id": messageId,
                "role": "assistant",
                "content": responseText,
                "parts": [{
                    "type": "text",
                    "text": responseText
                }],
                "createdAt": new Date().toISOString()
            };
            
            chatHistory[finalChatId].push(userMessage);
            chatHistory[finalChatId].push(assistantResponse);
            
            resolve({
                status: true,
                response: responseText,
                messageId: messageId,
                chatId: finalChatId
            });
        });

        response.data.on('error', (error) => {
            reject({
                status: false,
                error: error.message
            });
        });
    });
}

async function capcutdl(url) {
    const response = await fetch('https://3bic.com/api/download', {
        method: 'POST',
        headers: {
            'accept': 'application/json, text/plain, */*',
            'content-type': 'application/json',
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
            'referer': 'https://3bic.com/id'
        },
        body: JSON.stringify({ url: url })
    });
    
    const result = await response.json();
    
    if (result.code === 200) {
        result.fullVideoUrl = 'https://3bic.com' + result.originalVideoUrl;
    }
    
    return result;
}

module.exports = {
    capcutdl,
    unlimitedAIChat
};