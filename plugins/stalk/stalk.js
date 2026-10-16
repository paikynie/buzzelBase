const axios = require('axios');

/**
 * Account stalker plugin (Free Fire, Mobile Legends, Instagram).
 */
module.exports = {
    name: 'stalk',
    command: ['stalk-ff', 'freefire', 'stalk-mlbb', 'mlbb', 'stalk-ig', 'igstalk'],
    tags: ['stalk'],
    help: ['stalk-ff <uid>', 'stalk-mlbb <userID> <serverID>', 'stalk-ig <username>'],

    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock
     * @param {object} m
     * @param {object} ctx
     */
    async run(sock, m, { command, text, prefix, reply, config }) {
        if (command === 'stalk-ff' || command === 'freefire') {
            const args = text.trim().split(/\s+/);
            const uid = args[0];
            const region = (args[1] && args[1].startsWith('-')) ? args[1].substring(1).toLowerCase() : 'id';
            if (!uid) return reply(`${config.message.example}${prefix}${command} 5409563207`);

            await m.react('👍');
            try {
                const response = await axios.get(`https://kyuu2nd.dev/api/stalk/free-fire?uid=${uid}&region=${region}`);
                const data = response.data;

                if (data.status === false && data.result === 'Access denied. IP not whitelisted.') {
                    await m.react('❌');
                    return reply('IP tidak diizinkan, silakan hubungi owner');
                }

                if (data.status && data.result) {
                    const { basicInfo: basic = {}, clanBasicInfo: clan = {}, captainBasicInfo: captain = {}, petInfo: pet = {}, socialInfo: social = {} } = data.result;
                    const lastLogin = basic.lastLoginAt ? new Date(parseInt(basic.lastLoginAt, 10) * 1000).toLocaleDateString('id-ID') : '-';
                    const createAt = basic.createAt ? new Date(parseInt(basic.createAt, 10) * 1000).toLocaleDateString('id-ID') : '-';

                    let teks = `FREE FIRE STALKER\n\n- Nickname: ${basic.nickname || '-'}\n- UID: ${basic.accountId || '-'}\n- Region: ${basic.region ? basic.region.toUpperCase() : '-'}\n- Level: ${basic.level || 0}\n- Rank: ${basic.rank || 0}\n- CS Rank: ${basic.csRank || 0}\n- Liked: ${basic.liked || 0}\n- Elite Pass: ${basic.hasElitePass ? 'Ya' : 'Tidak'}\n- Last Login: ${lastLogin}\n- Account Created: ${createAt}\n`;

                    if (clan.clanName) {
                        teks += `\n- Clan: ${clan.clanName}\n- Clan Level: ${clan.clanLevel || 0}\n- Clan Captain: ${captain.nickname || '-'}\n`;
                    }
                    if (pet.id) {
                        teks += `\n- Pet ID: ${pet.id}\n- Pet Level: ${pet.level || 0}\n`;
                    }
                    if (social.signature && social.signature.trim()) {
                        teks += `\n- Signature: ${social.signature}\n`;
                    }
                    teks += `\n- Credit Score: ${data.result.creditScoreInfo?.creditScore || 0}`;

                    await reply(teks);
                    return m.react('✅');
                }
                await m.react('❌');
                return reply('User tidak ditemukan');
            } catch {
                await m.react('❌');
                return reply('Periksa ID atau kemungkinan API sedang down');
            }
        }

        if (command === 'stalk-mlbb' || command === 'mlbb') {
            const args = text.trim().split(/\s+/);
            const userID = args[0];
            const serverID = args[1] ? args[1].replace(/[()]/g, '') : '';
            if (!userID) return reply(`${config.message.example}${prefix}${command} userID serverID`);

            await m.react('👍');
            try {
                const response = await axios.get(`https://kyuu2nd.dev/api/stalk/mlbb-check?userID=${userID}&serverID=${serverID}`);
                const data = response.data;

                if (data.status === false && data.result === 'Access denied. IP not whitelisted.') {
                    await m.react('❌');
                    return reply('IP tidak diizinkan, silakan hubungi owner');
                }

                if (data.status && data.result) {
                    const result = data.result;
                    let diamondList = '';
                    let weeklyStatus = '';
                    let monthlyStatus = '';

                    if (result.info?.diamond) {
                        for (const d of result.info.diamond) {
                            if (d.title === 'Weekly Elite Bundle') {
                                weeklyStatus = `- Weekly Elite Bundle: ${d.available ? 'Tersedia' : 'Tidak tersedia'}\n`;
                            } else if (d.title === 'Monthly Epic Bundle') {
                                monthlyStatus = `- Monthly Epic Bundle: ${d.available ? 'Tersedia' : 'Tidak tersedia'}\n`;
                            } else {
                                diamondList += `- ${d.title}: ${d.available ? 'Tersedia' : 'Tidak tersedia'}\n`;
                            }
                        }
                    }

                    let accountList = '';
                    if (result.info?.account) {
                        const acc = result.info.account;
                        accountList += `- Moonton: ${acc.Moonton || '-'}\n- Google Play: ${acc['Google Play'] || '-'}\n- Tiktok: ${acc.Tiktok || '-'}\n- Device: ${acc.device || '-'}\n`;
                    }

                    const createdAt = result.info?.created_at || 'Tidak Diketahui';
                    const teks = `MLBB STALKER\n\n- Nickname: ${result.nickname || '-'}\n- User ID: ${result.userID || '-'}\n- Server ID: ${result.serverID || '-'}\n- Country: ${result.country || '-'}\n- Account Created: ${createdAt}\n\n> Diamond Packages:\n${diamondList || '- Tidak ada data\n'}${weeklyStatus}${monthlyStatus}\n> Linked Accounts:\n${accountList || '- Tidak ada data'}`;

                    await reply(teks);
                    return m.react('✅');
                }
                await m.react('❌');
                return reply('User tidak ditemukan');
            } catch {
                await m.react('❌');
                return reply('Periksa ID atau kemungkinan API sedang down');
            }
        }

        if (command === 'stalk-ig' || command === 'igstalk') {
            if (!text) return reply(`${config.message.example}${prefix}${command} username`);
            const username = text.replace('@', '').trim();
            await m.react('👍');

            try {
                const turnstileRes = await fetch(`https://kyuu2nd.dev/api/tools/turnstile-min?url=https://www.dolphinradar.com/instagram-new-follow-tracker&sitekey=0x4AAAAAAB6QhQUK_Fx885qf`);
                const tokenData = await turnstileRes.json();
                const captchaToken = tokenData.result;

                const fetchFollow = async (endpoint) => {
                    const res = await fetch(`https://www.dolphinradar.com/api/ins/recent/search/${endpoint}?pageNo=1&mediaName=${username}`, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
                            'captcha-token': captchaToken,
                            'tenantid': '6',
                            'referer': 'https://www.dolphinradar.com/instagram-new-follow-tracker'
                        }
                    });
                    const json = await res.json();
                    return json.data?.items ? json.data.items.map(i => i.media_name) : null;
                };

                const [followers, following] = await Promise.all([fetchFollow('followers'), fetchFollow('following')]);
                const dateStr = new Date().toLocaleDateString('id-ID');
                let teks = `Instagram Stalker\n\nUsername: @${username}\nDate: ${dateStr}\n\n`;

                if (!followers && !following) {
                    teks += 'Akun ini private atau tidak dapat diakses';
                } else {
                    teks += `Followers (${followers ? followers.length : 0}):\n`;
                    teks += followers ? followers.map(f => `- @${f}`).join('\n') : '- Tidak dapat diakses';
                    teks += `\n\nFollowing (${following ? following.length : 0}):\n`;
                    teks += following ? following.map(f => `- @${f}`).join('\n') : '- Tidak dapat diakses';
                }

                await reply(teks);
                return m.react('✅');
            } catch {
                await m.react('❌');
                return reply('Gagal mengambil data Instagram');
            }
        }
    }
};
