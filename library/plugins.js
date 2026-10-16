const fs = require('fs');
const path = require('path');

/**
 * @typedef {Object} Plugin
 * @property {string} [name]
 * @property {string|string[]} command
 * @property {string[]} [tags]
 * @property {string[]} [help]
 * @property {boolean} [isOwner]
 * @property {boolean} [isGroup]
 * @property {boolean} [isAdmins]
 * @property {boolean} [isBotAdmins]
 * @property {boolean} [isPrivate]
 * @property {Function} run
 */

class PluginManager {
    constructor(pluginDir = path.join(__dirname, '..', 'plugins')) {
        this.pluginDir = pluginDir;
        this.plugins = new Map();
        this.aliases = new Map();

        if (!fs.existsSync(this.pluginDir)) {
            fs.mkdirSync(this.pluginDir, { recursive: true });
        }

        this.init();
        this.watch();
    }

    /**
     * Scan and load all plugin files recursively.
     */
    init() {
        this.plugins.clear();
        this.aliases.clear();
        this.loadDirectory(this.pluginDir);
    }

    /**
     * Recursively loads all .js files in a directory.
     * @param {string} dir
     */
    loadDirectory(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                this.loadDirectory(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                this.loadPluginFile(fullPath);
            }
        }
    }

    /**
     * Loads a single plugin file into memory.
     * @param {string} filePath
     */
    loadPluginFile(filePath) {
        try {
            delete require.cache[require.resolve(filePath)];
            const plugin = require(filePath);

            if (!plugin || typeof plugin !== 'object' || typeof plugin.run !== 'function') {
                return;
            }

            const pluginKey = path.relative(this.pluginDir, filePath);
            this.plugins.set(pluginKey, {
                ...plugin,
                filePath
            });

            const commands = Array.isArray(plugin.command)
                ? plugin.command
                : (typeof plugin.command === 'string' ? [plugin.command] : []);

            for (const cmd of commands) {
                if (typeof cmd === 'string') {
                    this.aliases.set(cmd.toLowerCase(), pluginKey);
                }
            }
        } catch (err) {
            console.error(`[PluginManager] Failed to load plugin ${filePath}:`, err.message);
        }
    }

    /**
     * Removes a plugin from memory.
     * @param {string} filePath
     */
    unloadPluginFile(filePath) {
        try {
            const pluginKey = path.relative(this.pluginDir, filePath);
            const plugin = this.plugins.get(pluginKey);
            if (!plugin) return;

            const commands = Array.isArray(plugin.command)
                ? plugin.command
                : (typeof plugin.command === 'string' ? [plugin.command] : []);

            for (const cmd of commands) {
                if (typeof cmd === 'string' && this.aliases.get(cmd.toLowerCase()) === pluginKey) {
                    this.aliases.delete(cmd.toLowerCase());
                }
            }

            this.plugins.delete(pluginKey);
            delete require.cache[require.resolve(filePath)];
        } catch (err) {
            console.error(`[PluginManager] Failed to unload ${filePath}:`, err.message);
        }
    }

    /**
     * Watches plugin directory for real-time auto-reloading.
     */
    watch() {
        try {
            let reloadTimer = null;
            const watcher = fs.watch(this.pluginDir, { recursive: true }, (eventType, filename) => {
                if (!filename || !filename.endsWith('.js')) return;

                clearTimeout(reloadTimer);
                reloadTimer = setTimeout(() => {
                    const fullPath = path.join(this.pluginDir, filename);
                    if (fs.existsSync(fullPath)) {
                        this.loadPluginFile(fullPath);
                    } else {
                        this.unloadPluginFile(fullPath);
                    }
                }, 200);
            });
            if (typeof watcher.unref === 'function') {
                watcher.unref();
            }
        } catch (err) {
            console.error('[PluginManager] Watch error:', err.message);
        }
    }

    /**
     * Finds a plugin by command name.
     * @param {string} command
     * @returns {Plugin|null}
     */
    find(command) {
        if (!command || typeof command !== 'string') return null;
        const pluginKey = this.aliases.get(command.toLowerCase());
        if (!pluginKey) return null;
        return this.plugins.get(pluginKey) || null;
    }

    /**
     * Returns all registered plugins.
     * @returns {Plugin[]}
     */
    getAll() {
        return Array.from(this.plugins.values());
    }
}

module.exports = new PluginManager();
