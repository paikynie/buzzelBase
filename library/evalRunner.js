const util = require('util');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const MAX_OUTPUT_LENGTH = 20000;
const MAX_ERROR_LENGTH = 3000;

/**
 * Format an object with detailed inspection.
 * @param {*} value
 * @returns {string}
 */
function formatEvalObject(value) {
    return util.inspect(value, {
        colors: false,
        depth: 4,
        getters: false,
        compact: false,
        maxArrayLength: 100,
        maxStringLength: 2000
    });
}

/**
 * Transforms ES6 import/export syntax to dynamic require/import for eval execution.
 * @param {string} code
 * @returns {string}
 */
function transformImports(code) {
    let result = code;
    result = result.replace(/import\s*\*\s*as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g, `const $1 = await importModule('$2');`);
    result = result.replace(/import\s+(\w+)\s*,\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"];?/g, `const { default: $1, $2 } = await importModule('$3');`);
    result = result.replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g, `const $1 = (await importModule('$2')).default;`);
    result = result.replace(/import\s*\{\s*([^}]+)\s*\}\s*from\s+['"]([^'"]+)['"];?/g, `const { $1 } = await importModule('$2');`);
    result = result.replace(/^export\s+(default\s+)?/gm, '');
    result = result.replace(/^export\s+\{[^}]*\};?\s*$/gm, '');
    return result;
}

/**
 * Creates a fake console capturing stdout/stderr messages.
 * @returns {{consoleOutput: string[], fakeConsole: object}}
 */
function createFakeConsole() {
    const consoleOutput = [];
    const format = (...args) => args.map((arg) =>
        typeof arg === 'object' && arg !== null
            ? util.inspect(arg, { depth: 3, colors: false })
            : String(arg)
    ).join(' ');

    const write = (method, args) => {
        consoleOutput.push(format(...args));
        if (typeof console[method] === 'function') {
            console[method](...args);
        }
    };

    return {
        consoleOutput,
        fakeConsole: {
            log: (...args) => write('log', args),
            error: (...args) => write('error', args),
            warn: (...args) => write('warn', args),
            info: (...args) => write('info', args)
        }
    };
}

/**
 * Formats evaluation result and intercepted console output.
 * @param {*} evaled
 * @param {string[]} consoleOutput
 * @returns {string}
 */
function formatEvalResult(evaled, consoleOutput) {
    let output = '';
    if (consoleOutput.length > 0) {
        output += `📜 Console:\n${consoleOutput.join('\n')}\n\n`;
    }

    if (evaled === undefined) {
        if (consoleOutput.length === 0) output += 'undefined';
    } else if (evaled === null) {
        output += 'null';
    } else if (Buffer.isBuffer(evaled)) {
        output += `<Buffer ${evaled.length} bytes>\n${evaled.slice(0, 200).toString('utf8')}`;
    } else if (typeof evaled === 'object') {
        output += formatEvalObject(evaled);
    } else if (typeof evaled === 'function') {
        output += util.inspect(evaled, { depth: 4, colors: false });
    } else {
        output += String(evaled);
    }

    if (!output.trim()) {
        output = 'Selesai (No Output)';
    }

    return output.length > MAX_OUTPUT_LENGTH
        ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n... (truncated)'
        : output;
}

/**
 * Formats evaluation error messages cleanly.
 * @param {Error|*} err
 * @returns {string}
 */
function formatEvalError(err) {
    let errText = err?.stack || err?.message || String(err);
    if (errText.length > MAX_ERROR_LENGTH) {
        errText = errText.slice(0, MAX_ERROR_LENGTH) + '\n... (truncated)';
    }
    return errText;
}

/**
 * Evaluates asynchronous JavaScript code inside given context.
 * @param {string} code
 * @param {object} context
 * @returns {Promise<*>}
 */
async function executeAsyncCode(code, context) {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const names = Object.keys(context);
    const values = Object.values(context);
    let fn;
    const raw = (code || '').trim();
    const trimmedCode = raw.replace(/;+$/, '');

    try {
        fn = new AsyncFunction(...names, `return (\n${trimmedCode}\n)`);
    } catch {
        const lines = raw.split('\n');
        const lastLine = lines[lines.length - 1].trim().replace(/;+$/, '');
        if (!lastLine.startsWith('return ') && !/^(const|let|var|throw)\s/.test(lastLine)) {
            const candidate = lines.slice(0, -1).concat(`return (${lastLine})`).join('\n');
            try {
                fn = new AsyncFunction(...names, candidate);
            } catch {}
        }
        if (!fn) {
            fn = new AsyncFunction(...names, code);
        }
    }
    return fn(...values);
}

/**
 * Builds standard eval execution context.
 * @param {object} m
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {object} [store]
 * @param {object} [config]
 * @returns {object}
 */
function buildEvalContext(m, sock, store, config) {
    return {
        m,
        sock,
        conn: sock,
        quoted: m?.quoted || null,
        q: m?.quoted || null,
        chat: m?.chat,
        jid: m?.chat,
        from: m?.chat,
        sender: m?.sender,
        store: store || null,
        config: config || require('../settings/config'),
        plugins: require('./plugins'),
        Buffer,
        process,
        require,
        importModule: (spec) => import(spec),
        util,
        fs,
        path,
        axios,
        baileys: require('@whiskeysockets/baileys')
    };
}

/**
 * Executes user code safely and formats result as a markdown code block.
 * @param {string} code
 * @param {object} m
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {object} [store]
 * @param {object} [config]
 * @returns {Promise<string>}
 */
async function runUserCode(code, m, sock, store, config) {
    const { consoleOutput, fakeConsole } = createFakeConsole();

    try {
        const context = {
            ...buildEvalContext(m, sock, store, config),
            console: fakeConsole,
            __dirname: process.cwd(),
            __filename: '[eval]'
        };

        const transformed = transformImports(code);
        const result = await executeAsyncCode(transformed, context);
        return '```' + formatEvalResult(result, consoleOutput) + '```';
    } catch (err) {
        return `Error:\n\`\`\`js\n${formatEvalError(err)}\n\`\`\``;
    }
}

module.exports = {
    runUserCode,
    buildEvalContext,
    transformImports,
    createFakeConsole,
    formatEvalResult,
    formatEvalError,
    executeAsyncCode
};
