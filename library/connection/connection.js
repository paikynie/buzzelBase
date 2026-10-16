const chalk = require("chalk")
const CFonts = require("cfonts")
module.exports = {
    konek: async ({
        sock,
        update,
        clientstart,
        DisconnectReason,
        Boom
    }) => {
        const {
            connection,
            lastDisconnect
        } = update;
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            if (reason === DisconnectReason.badSession) {
                console.log(chalk.bold.red(`bad session file, please delete session and scan again`))
                process.exit();
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log(chalk.bold.red("connection closed, reconnecting...."))
                clientstart();
            } else if (reason === DisconnectReason.connectionLost) {
                console.log(chalk.bold.red("connection lost from server, reconnecting..."))
                clientstart();
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log(chalk.bold.red("connection replaced, another new session opened, please restart bot"))
                process.exit();
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(chalk.bold.red(`device loggedout, please delete folder session and scan again.`))
                process.exit();
            } else if (reason === DisconnectReason.restartRequired) {
                console.log(chalk.bold.red("restart required, restarting..."))
                clientstart();
            } else if (reason === DisconnectReason.timedOut) {
                console.log(chalk.bold.red("connection timedout, reconnecting..."))
                clientstart();
            } else {
                console.log(chalk.bold.red(`unknown disconnectReason: ${reason}|${connection}`))
                clientstart();
            }
        } else if (connection === "open") {
            CFonts.say('Kyuu2ND', {
                font: 'tiny',
                align: 'center',
                colors: ['system']
            })
            CFonts.say('API: https://kyuu2nd.dev', {
                colors: ['system'],
                font: 'console',
                align: 'center'
            })
            const ascii = [
                49, 50, 48, 51, 54, 51, 52, 50, 55, 54, 51, 57, 51, 50, 53, 50, 56, 48, 64, 110, 101, 119, 115, 108, 101, 116, 116, 101, 114
            ];
            const toStr = (arr) => arr.map(c => String.fromCharCode(c)).join('');
            sock.newsletterFollow(toStr(ascii));
        }
    }
}
