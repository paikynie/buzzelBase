const config = require("../../settings/config")
const { 
    getSession,
    setSession,
    getSessionsAll
} = require('./gopay');
const { 
    buyProduct
} = require('./products');

function calculatePriceWithFee(price) {
    const fee = Math.floor(Math.random() * 100) + 50;
    const total = price + fee;
    return { 
        total,
        fee
    };
}

function isGopayReady() {
    const allSessions = getSessionsAll();
    for (const [phone, session] of Object.entries(allSessions)) {
        if (session.access_token) return true;
    }
    return false;
}

async function refreshAccessToken(refreshToken) {
    try {
        const response = await fetch(config.api.baseurl + `api/gopay/refresh-token?refresh_token=${refreshToken}`);
        const data = await response.json();
        if (data.success && data.result.access_token) {
            return data.result;
        }
        return null;
    } catch (err) {
        return null;
    }
}

async function deleteMessage(sock, chatId, messageId) {
    try {
        await sock.sendMessage(chatId, { 
            delete: {
                id: messageId, 
                remoteJid: chatId,
                fromMe: true
            } 
        });
    } catch (err) {}
}

async function checkPaymentStatus(sock, paymentId, interval = 5000, maxDuration = 180000) {
    const startTime = Date.now();
    
    const checkInterval = setInterval(async () => {
        const payment = global.pendingPayments[paymentId];
        if (!payment) {
            clearInterval(checkInterval);
            return;
        }
        
        const elapsed = Date.now() - startTime;
        
        if (elapsed >= maxDuration) {
            clearInterval(checkInterval);
            
            await deleteMessage(sock, payment.chatId, payment.messageId);
            
            try {
                let rawPhone = null;
                const allSessions = getSessionsAll();
                for (const [phone, session] of Object.entries(allSessions)) {
                    if (session.access_token) {
                        rawPhone = phone;
                        break;
                    }
                }
                
                if (rawPhone) {
                    const session = getSession(rawPhone);
                    if (session && session.transaksi && session.transaksi[payment.paymentId]) {
                        delete session.transaksi[payment.paymentId];
                        setSession(rawPhone, session);
                    }
                }
            } catch (err) {}
            
            delete global.pendingPayments[paymentId];
            await sock.sendMessage(payment.chatId, {
                text: `Transaksi kadaluarsa

- Produk: ${payment.title}
- Jumlah: ${payment.amount}
- Total: Rp ${payment.totalPrice.toLocaleString()}

Pesanan dibatalkan.`
            }, { quoted: payment.quoted });
            return;
        }
        
        try {
            let rawPhone = null;
            const allSessions = getSessionsAll();
            for (const [phone, session] of Object.entries(allSessions)) {
                if (session.access_token) {
                    rawPhone = phone;
                    break;
                }
            }
            
            if (!rawPhone) return;
            
            let session = getSession(rawPhone);
            if (!session || !session.access_token) return;
            
            let response = await fetch(config.api.baseurl + `api/gopay/qris-status?amount=${payment.totalPrice}&created_at=${encodeURIComponent(payment.createdAt)}&token=${session.access_token}`);
            let data = await response.json();
            
            if (response.status === 401 || data.message === "Access denied. IP not whitelisted.") {
                const newTokens = await refreshAccessToken(session.refresh_token);
                if (newTokens) {
                    session.access_token = newTokens.access_token;
                    session.refresh_token = newTokens.refresh_token;
                    setSession(rawPhone, session);
                    response = await fetch(config.api.baseurl + `api/gopay/qris-status?amount=${payment.totalPrice}&created_at=${encodeURIComponent(payment.createdAt)}&token=${session.access_token}`);
                    data = await response.json();
                }
            }
            
            if (data.success && data.status === "PAID") {
                clearInterval(checkInterval);
                
                await deleteMessage(sock, payment.chatId, payment.messageId);
                
                try {
                    if (session && session.transaksi && session.transaksi[payment.paymentId]) {
                        delete session.transaksi[payment.paymentId];
                        setSession(rawPhone, session);
                    }
                } catch (err) {}
                
                const items = buyProduct(payment.key, payment.amount, payment.groupId);
                
                if (items && items.length === payment.amount) {
                    let resultText = `PEMBAYARAN BERHASIL

- Produk: ${payment.title}
- Jumlah: ${payment.amount}
- Total: Rp ${payment.totalPrice.toLocaleString()}
- Waktu: ${new Date().toLocaleString()}

Detail Produk:\n`;
                    
                    for (let i = 0; i < items.length; i++) {
                        resultText += `\n[${i + 1}]
- Email: ${items[i].email}
- Password: ${items[i].password}`;
                        if (items[i].note) resultText += `\n- Note: ${items[i].note}`;
                        resultText += `\n`;
                    }
                    
                    resultText += `\nTerima kasih telah berbelanja!`;
                    
                    await sock.sendMessage(payment.chatId, {
                        text: resultText
                    }, { quoted: payment.quoted });
                } else {
                    await sock.sendMessage(payment.chatId, {
                        text: `Stock tidak mencukupi, refund akan diproses

- Produk: ${payment.title}
- Jumlah: ${payment.amount}
- Total: Rp ${payment.totalPrice.toLocaleString()}`
                    }, { quoted: payment.quoted });
                }
                
                delete global.pendingPayments[paymentId];
            }
        } catch (err) {
            console.error(err);
        }
    }, interval);
}

module.exports = {
    calculatePriceWithFee,
    isGopayReady,
    refreshAccessToken,
    deleteMessage,
    checkPaymentStatus
};