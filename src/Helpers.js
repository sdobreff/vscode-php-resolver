let vscode = require('vscode');

const USER_CONFIG_FILE_NAME = 'user.resolver.config.json';

const USER_CONFIG_FIXER_FILE_NAME = 'user.resolver.fixer.config.php';

const activeEditor = () => {
    return vscode.window.activeTextEditor;
}

const config = (key) => {
    return vscode.workspace.getConfiguration('phpResolver').get(key);
}

const showMessage = (message, error = false) => {
    if (config('showMessageOnStatusBar')) {
        return vscode.window.setStatusBarMessage(message, 3000);
    }

    message = message.replace(/\$\(.+?\)\s\s/, '');

    if (error) {
        vscode.window.showErrorMessage(message);
    } else {
        vscode.window.showInformationMessage(message);
    }
}

const showExtensionMessage = (message, ...args) => {
    const header = "PHP Resolver";
    const options = { detail: message, modal: false };
    vscode.window.showInformationMessage(message, ...args).then(selection => {
        if (selection === 'OK') {
            vscode.env.openExternal(vscode.Uri.parse(
                'https://github.com/sdobreff/vscode-php-resolver'));
        }
    });
}

const showErrorMessage = (message) => {
    showMessage(message, true);
}

const isNewerVersion = (oldVer, newVer) => {
    const oldParts = oldVer.split('.')
    const newParts = newVer.split('.')
    for (var i = 0; i < newParts.length; i++) {
        const a = ~~newParts[i] // parse int
        const b = ~~oldParts[i] // parse int
        if (a > b) return true
        if (a < b) return false
    }
    return false
}

module.exports = { activeEditor, config, showMessage, showErrorMessage, USER_CONFIG_FILE_NAME, USER_CONFIG_FIXER_FILE_NAME, isNewerVersion, showExtensionMessage };