const { addCatalog, addStock, buyProduct, getAllCatalog, getProductByKey, deleteCatalog } = require('../../library/_function/products');
const { getSession, setSession, deleteSession, getSessionsAll } = require('../../library/_function/gopay');
const { calculatePriceWithFee, isGopayReady, checkPaymentStatus } = require('../../library/_function/GopayStore');

/**
 * Normalizes phone number format.
 * @param {string} phone
 * @returns {string}
 */
function normalizePhone(phone) {
    let clean = String(phone).replace(/\D/g, '');
    if (clean.startsWith('62')) clean = clean.substring(2);
    if (clean.startsWith('0')) clean = clean.substring(1);
    return clean;
}

/**
 * Digital store and e-commerce plugin (Catalog, Stock, Buy, GoPay QRIS).
 */
module.exports = {
    name: 'store',
    command: ['listcatalog', 'listcat', 'addcatalog', 'addcat', 'delcatalog', 'delcat', 'addstock', 'addstok', 'buy', 'buyproduct', 'gopay', 'gojek'],
    tags: ['store'],
    help: ['listcatalog', 'addcatalog <title|desc|key|price>', 'delcatalog <key>', 'buy <key> <jumlah>', 'gopay login/verify'],

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { command, text, prefix, isOwner, reply, config, store }) {
        if (command === 'listcatalog' || command === 'listcat') {
            const groupId = m.chat;
            const catalog = getAllCatalog(groupId);
            if (catalog.length === 0) return reply('Belum ada katalog');

            let teks = 'Daftar Katalog:\n\n';
            catalog.forEach((c, i) => {
                teks += `${i + 1}. ${c.title}\n`;
                teks += `> Key: ${c.key}\n`;
                teks += `> Harga: Rp ${c.price.toLocaleString()}\n`;
                teks += `> Stock: ${c.stock}\n`;
                teks += `> Terjual: ${c.sold}\n`;
                teks += `> Desk: ${c.desc}\n\n`;
            });
            teks += `Cara beli: ${prefix}buy KEY JUMLAH\nContoh: ${prefix}buy ${catalog[0]?.key} 1`;
            return reply(teks);
        }

        if (command === 'delcatalog' || command === 'delcat') {
            if (!isOwner) return reply(config.message.owner);
            if (!isGopayReady()) return reply(config.message.loGopay);
            if (!text) return reply(`${config.message.example}${prefix}${command} KEY`);

            const key = text.trim().toLowerCase();
            const groupId = m.chat;
            const product = getProductByKey(key, groupId);
            if (!product) return reply(`Key ${key} tidak ditemukan`);

            if (deleteCatalog(key, groupId)) {
                return reply(`Katalog dihapus:\n\n- Title: ${product.title}\n- Key: ${product.key}`);
            }
            return reply(`Gagal menghapus katalog ${key}`);
        }

        if (command === 'addcatalog' || command === 'addcat') {
            if (!isOwner) return reply(config.message.owner);
            if (!isGopayReady()) return reply(config.message.loGopay);

            const parts = text.split('|');
            if (parts.length < 4) return reply(`${config.message.example}${prefix}${command} TITLE|DESC|KEY|HARGA`);

            const title = parts[0].trim();
            const desc = parts[1].trim();
            const key = parts[2].trim().toLowerCase();
            const price = parseInt(parts[3].trim(), 10);
            const groupId = m.chat;

            if (isNaN(price)) return reply('Harga harus berupa angka');
            if (addCatalog(title, desc, key, price, groupId)) {
                return reply(`Katalog ditambahkan:\n\n- Title: ${title}\n- Desc: ${desc}\n- Key: ${key}\n- Harga: Rp ${price.toLocaleString()}`);
            }
            return reply(`Key ${key} sudah ada`);
        }

        if (command === 'addstock' || command === 'addstok') {
            if (!isOwner) return reply(config.message.owner);
            if (!isGopayReady()) return reply(config.message.loGopay);

            const parts = text.split('|');
            if (parts.length < 3) return reply(`${config.message.example}${prefix}${command} KEY|EMAIL|PASSWORD|NOTE`);

            const key = parts[0].trim().toLowerCase();
            const email = parts[1].trim();
            const password = parts[2].trim();
            const note = parts[3] ? parts[3].trim() : '';
            const groupId = m.chat;

            if (addStock(key, email, password, note, groupId)) {
                const product = getProductByKey(key, groupId);
                return reply(`Stock ditambahkan:\n\n- Produk: ${product.title}\n- Email: ${email}\n- Pass: ${password}\n- Note: ${note}\n\n- Total stock: ${product.stock}`);
            }
            return reply(`Key ${key} tidak ditemukan`);
        }

        if (command === 'buy' || command === 'buyproduct') {
            if (!text) return reply(`${config.message.example}${prefix}${command} KEY JUMLAH`);
            const args = text.trim().split(/\s+/);
            const key = args[0].toLowerCase();
            const amount = parseInt(args[1], 10) || 1;
            const groupId = m.chat;

            if (isNaN(amount) || amount <= 0) return reply('Jumlah tidak valid');

            const product = getProductByKey(key, groupId);
            if (!product) return reply(`Key ${key} tidak ditemukan`);
            if (product.stock < amount) return reply(`Stock tidak mencukupi. Sisa stock: ${product.stock}`);

            const { total: totalPrice, fee } = calculatePriceWithFee(product.price * amount);
            const paymentId = `${key}-${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            const response = await fetch(`https://kyuu2nd.dev/api/gopay/create-qris?amount=${totalPrice}&static_qr=${config.staticQr}`);
            const data = await response.json();

            if (data.success) {
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
                    if (session) {
                        session.transaksi = session.transaksi || {};
                        session.transaksi[paymentId] = {
                            url: data.result.url,
                            filename: data.result.filename,
                            created_at: data.result.created_at,
                            amount: totalPrice,
                            status: 'PENDING'
                        };
                        setSession(rawPhone, session);
                    }
                }

                const sentMsg = await sock.sendMessage(m.chat, {
                    image: { url: data.result.url },
                    caption: `Pembelian:\n\n- Produk: ${product.title}\n- Jumlah: ${amount}\n- Total: Rp ${totalPrice.toLocaleString()}\n- Fee: Rp ${fee.toLocaleString()}\n\nScan QRIS untuk pembayaran.\nWaktu: 3 menit\nID: ${paymentId}`
                }, { quoted: m });

                global.pendingPayments = global.pendingPayments || {};
                global.pendingPayments[paymentId] = {
                    key: product.key,
                    title: product.title,
                    amount,
                    totalPrice,
                    createdAt: data.result.created_at,
                    chatId: m.chat,
                    quoted: m,
                    paymentId,
                    messageId: sentMsg.key.id,
                    groupId
                };

                checkPaymentStatus(sock, paymentId);
            } else {
                reply(config.message.staticQr);
            }
        }

        if (command === 'gopay' || command === 'gojek') {
            if (!isOwner) return reply(config.message.owner);

            const args = text.trim().split(/\s+/);
            const subCommand = args[0] ? args[0].toLowerCase() : null;

            if (subCommand === 'login') {
                const phone = args[1];
                if (!phone) return reply(`${config.message.example}${prefix}${command} login 81351692548`);

                const rawPhone = normalizePhone(phone);
                const response = await fetch(`https://kyuu2nd.dev/api/gopay/otp?phone=${rawPhone}`);
                const data = await response.json();

                if (data.success) {
                    setSession(rawPhone, {
                        otp_token: data.result.otp_token,
                        phone: rawPhone,
                        expires_in: data.result.otp_expires_in,
                        timestamp: Date.now(),
                        transaksi: {}
                    });
                    return reply(`OTP dikirim ke nomor ${rawPhone}\n\n- OTP: ${data.result.otp_token.substring(0, 8)}...\n\nLanjutkan: ${prefix}gopay verify ${rawPhone} *KODE_OTP*`);
                }
                return reply('Gagal mengirim OTP');
            }

            if (subCommand === 'verify') {
                const phone = args[1];
                const otp = args[2];
                if (!phone || !otp) return reply(`${config.message.example}${prefix}${command} verify 81351692548 123456`);

                const rawPhone = normalizePhone(phone);
                const session = getSession(rawPhone);
                if (!session || !session.otp_token) return reply('Session tidak ditemukan');

                const response = await fetch(`https://kyuu2nd.dev/api/gopay/verify?otp=${otp}&otp_token=${session.otp_token}`);
                const data = await response.json();

                if (data.success) {
                    session.access_token = data.result.access_token;
                    session.refresh_token = data.result.refresh_token;
                    delete session.otp_token;
                    setSession(rawPhone, session);
                    return reply('Verifikasi berhasil\n\nSekarang bot siap digunakan untuk transaksi.');
                }
                return reply('Verifikasi gagal');
            }

            if (subCommand === 'logout') {
                let rawPhone = null;
                const allSessionsData = getSessionsAll();
                for (const [phone, session] of Object.entries(allSessionsData)) {
                    if (session.access_token) {
                        rawPhone = phone;
                        break;
                    }
                }
                if (!rawPhone) return reply('Belum login');
                deleteSession(rawPhone);
                return reply(`Berhasil logout dari nomor ${rawPhone}`);
            }

            return reply(`GoPay Commands:\n\n- ${prefix}${command} login 8xxx - Kirim OTP\n- ${prefix}${command} verify 8xxx 1234 - Verifikasi OTP\n- ${prefix}${command} logout - Hapus session`);
        }
    }
};
