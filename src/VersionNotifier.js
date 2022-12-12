const path = require('path');
let fs = require('fs');
let { USER_CONFIG_FILE_NAME, isNewerVersion, showExtensionMessage } = require('./Helpers');

class VersionNotifier {
    userConfigFileUri = path.join(__dirname, '../' + USER_CONFIG_FILE_NAME);

    async setProperVersion() {
        let userConfig = await this.getUserConfig();
        const meta = require('../package.json')
        if (!userConfig) {
            this.writeUserConfigFile(meta.version);
            await showExtensionMessage(meta.newVersion, 'OK');
        } else {
            //vscode.extensions.getExtension('StoilDobreff.php-resolver').show();
            if (isNewerVersion(userConfig.version, meta.version)) {
                this.writeUserConfigFile(meta.version);
                await showExtensionMessage(meta.versionChanges, 'OK');
            }
        }
    }

    getUserConfig() {
        return new Promise((resolve, reject) => {
            try {
                if (fs.existsSync(this.userConfigFileUri)) {
                    resolve(require(this.userConfigFileUri));
                } else {
                    resolve(false);
                }
            } catch {

            }
        });
    }

    async writeUserConfigFile(version) {
        let latestVersion = {
            version: version,
        };

        let data = JSON.stringify(latestVersion);
        await fs.writeFileSync(this.userConfigFileUri, data);
    }
}

module.exports = VersionNotifier;