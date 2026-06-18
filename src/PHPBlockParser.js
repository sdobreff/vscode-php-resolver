let vscode = require('vscode');

class DocParam {
    constructor(type, name) {
        this.type = type;
        this.name = name;
    }
}

class DocBlock {
    constructor(message = "") {
        this.params = [];
        this.indentCharacter = " ";
        this.message = message;
        this.return = null;
        this.var = null;
    }

    build(forceFallback = false) {
        let extra = PHPStoredData.instance.get("extra");
        let gap = PHPStoredData.instance.get("gap");
        let returnGap = PHPStoredData.instance.get("returnGap");
        let alignReturnWithParams = PHPStoredData.instance.get("alignParams")
            ? PHPStoredData.instance.get("alignReturn")
            : false;

        if (forceFallback) {
            gap = true;
            extra = [];
        }

        const message = "${###" + (this.message !== "" ? ":" : "") + this.message + "}";
        const maxLengths = this.getMaxParamLength(this.params, this.return);

        let paramSection = "";
        if (this.params.length) {
            paramSection = this.params.map((param) => {
                const escapedName = param.name.replace("$", "\\$");
                const spacing = this.getParamAlignmentSpaces(maxLengths, escapedName, param.type);
                let line = "@param "
                    + (alignReturnWithParams ? this.indentCharacter : "")
                    + "${###:" + param.type + "} "
                    + spacing.prepend
                    + escapedName
                    + spacing.append;

                const paramDescription = PHPStoredData.instance.get("paramDescription");
                if (paramDescription === true) {
                    line += "${###}";
                } else if (typeof paramDescription === "string") {
                    line += "${###:" + paramDescription + "}";
                }

                return line;
            }).join("\n");
        }

        let varSection = "";
        if (this.var) {
            varSection = "@var ${###:" + this.var + "}";
            const varDescription = PHPStoredData.instance.get("varDescription");
            if (varDescription === true) {
                varSection += " ${###}";
            } else if (typeof varDescription === "string") {
                varSection += " ${###:" + varDescription + "}";
            }
        }

        let returnSection = "";
        if (this.return && (this.return !== "void" || PHPStoredData.instance.get("returnVoid"))) {
            const spacing = this.getReturnAlignmentSpaces(maxLengths);
            returnSection = "@return ${###:" + this.return + "}" + spacing.append;

            const returnDescription = PHPStoredData.instance.get("returnDescription");
            if (returnDescription === true) {
                returnSection += "${###}";
            } else if (typeof returnDescription === "string") {
                returnSection += "${###:" + returnDescription + "}";
            }
        }

        let extraSection = "";
        if (Array.isArray(extra) && extra.length > 0) {
            extraSection = extra.join("\n");
        }

        const parsedParts = [];
        const template = this.template;

        for (const key in template) {
            const partConfig = template[key];
            let partValue;

            if (key === "message" && message) {
                partValue = message;
                if (gap) {
                    partConfig.gapAfter = true;
                }
            } else if (key === "var" && varSection) {
                partValue = varSection;
            } else if (key === "return" && returnSection) {
                partValue = returnSection;
                if (returnGap) {
                    partConfig.gapBefore = true;
                }
            } else if (key === "param" && paramSection) {
                partValue = paramSection;
            } else if (key === "extra" && extraSection) {
                partValue = extraSection;
            } else if (partConfig.content !== undefined) {
                partValue = partConfig.content;
            }

            if (!partValue) {
                continue;
            }

            if (partConfig.gapBefore && parsedParts[parsedParts.length - 1] !== "") {
                parsedParts.push("");
            }

            parsedParts.push(partValue);

            if (partConfig.gapAfter) {
                parsedParts.push("");
            }
        }

        if (parsedParts[parsedParts.length - 1] === "") {
            parsedParts.pop();
        }

        let snippetText = parsedParts.join("\n");
        let interpolationIndex = 0;
        snippetText = snippetText.replace(/###/gm, function () {
            interpolationIndex += 1;
            return interpolationIndex + "";
        });
        snippetText = snippetText.replace(/^$/gm, " *");
        snippetText = snippetText.replace(/^(?!(\s\*|\/\*))/gm, " * $1");

        if (PHPStoredData.instance.get("autoClosingBrackets") === "never") {
            snippetText = "\n" + snippetText + "\n */";
        } else {
            snippetText = "/**\n" + snippetText + "\n */";
        }

        return new vscode.SnippetString(snippetText);
    }

    set template(value) {
        this._template = value;
    }

    get template() {
        if (this._template == null) {
            return {
                message: {},
                var: {},
                param: {},
                return: {},
                extra: {}
            };
        }

        return this._template;
    }

    getMaxParamLength(params, returnType) {
        const alignParams = PHPStoredData.instance.get("alignParams");
        const alignReturn = alignParams ? PHPStoredData.instance.get("alignReturn") : false;
        let maxTypeLength = 0;
        let maxNameLength = 0;

        if (params.length && alignParams) {
            params.forEach((param) => {
                if (param.type.length > maxTypeLength) {
                    maxTypeLength = param.type.length;
                }

                const escapedName = param.name.replace("$", "\\$");
                if (escapedName.length > maxNameLength) {
                    maxNameLength = escapedName.length;
                }
            });
        }

        if (returnType && (returnType !== "void" || PHPStoredData.instance.get("returnVoid")) && alignReturn) {
            if (returnType.length > maxTypeLength) {
                maxTypeLength = returnType.length;
            }
        }

        return {
            type: maxTypeLength,
            name: maxNameLength
        };
    }

    getParamAlignmentSpaces(maxLengths, escapedName, type) {
        const alignParams = PHPStoredData.instance.get("alignParams");
        const withDescription = PHPStoredData.instance.get("paramDescription");
        let prepend = "";
        let append = "";

        if (alignParams) {
            prepend = Array(maxLengths.type - type.length).fill(this.indentCharacter).join("");
            append = Array(1 + maxLengths.name - escapedName.length).fill(this.indentCharacter).join("");
        }

        return {
            prepend: prepend,
            append: withDescription ? (alignParams ? append : this.indentCharacter) : ""
        };
    }

    getReturnAlignmentSpaces(maxLengths) {
        const alignReturn = PHPStoredData.instance.get("alignParams")
            ? PHPStoredData.instance.get("alignReturn")
            : false;
        const withDescription = PHPStoredData.instance.get("returnDescription");

        let append = "";
        if (alignReturn) {
            append = Array(1 + maxLengths.type - this.return.length).fill(this.indentCharacter).join("")
                + Array(maxLengths.name).fill(this.indentCharacter).join("");
        }

        return {
            prepend: "",
            append: withDescription ? (alignReturn ? append : this.indentCharacter) : ""
        };
    }
}

class BaseParser {
    constructor(position, editor) {
        this.signatureEnd = /[\{;]/;
        this.position = position;
        this.editor = editor;
        this.setSignature(this.getBlock(position, this.signatureEnd));
    }

    test() {
        return this.pattern.test(this.signature);
    }

    match() {
        return this.signature.match(this.pattern);
    }

    setSignature(block) {
        this.signature = block;
    }

    getBlock(position, endPattern) {
        let lineIndex = position.line + 1;
        if (lineIndex >= this.editor.document.lineCount) {
            return "";
        }

        let currentLine = this.editor.document.lineAt(lineIndex).text;
        let firstNonWhitespace = currentLine.search(/[^\s]/);
        if (firstNonWhitespace === -1) {
            return "";
        }

        const start = new vscode.Position(position.line + 1, firstNonWhitespace);

        while (!endPattern.test(currentLine) && lineIndex < this.editor.document.lineCount - 1) {
            lineIndex += 1;
            currentLine = this.editor.document.lineAt(lineIndex).text;
        }

        const end = new vscode.Position(lineIndex, currentLine.search(endPattern));
        const range = new vscode.Range(start, end);
        return this.editor.document.getText(range);
    }

    getEnclosed(value, open, close) {
        let depth = 0;
        const chars = value.split("");
        let end = 0;

        for (let index = 0; index < chars.length; index += 1) {
            const char = chars[index];
            if (char === close && depth === 0) {
                end = index;
                break;
            }

            if (char === close) {
                depth -= 1;
            } else if (char === open) {
                depth += 1;
            }

            end = index;
        }

        return value.substr(0, end);
    }

    getSplitWithoutEnclosed(value, splitBy = ",") {
        const parts = [];
        const chars = value.split("");
        const openers = ["{", "(", "["];
        const closers = ["}", ")", "]"];

        let depth = 0;
        let start = 0;
        let end = 0;

        for (let index = 0; index < chars.length; index += 1) {
            const char = chars[index];

            if (char === splitBy && index === chars.length - 1) {
                break;
            }

            if (char === splitBy && depth === 0) {
                end = index;
                parts.push(value.substr(start, end - start));
                start = index + 1;
                continue;
            }

            if (openers.indexOf(char) >= 0) {
                depth += 1;
            } else if (closers.indexOf(char) >= 0) {
                depth -= 1;
            }

            end = index;
        }

        const tail = value.substr(start, end - start + 1);
        if (!tail.match(/^\s*$/)) {
            parts.push(tail);
        }

        return parts;
    }

    getClassHead() {
        if (this.classHead !== undefined) {
            return this.classHead;
        }

        const maxLine = this.editor.document.lineCount < 300
            ? this.editor.document.lineCount - 1
            : 300;
        const text = this.editor.document.getText(
            new vscode.Range(new vscode.Position(0, 0), new vscode.Position(maxLine, 0))
        );
        const classHeadMatch = /\s*(abstract|final)?\s*(class|trait|interface)/gm.exec(text);

        if (classHeadMatch === null) {
            this.classHead = null;
        } else {
            const classPosition = this.editor.document.positionAt(classHeadMatch.index);
            this.classHead = this.editor.document.getText(
                new vscode.Range(new vscode.Position(0, 0), classPosition)
            );
        }

        return this.classHead;
    }
}

class PHPStoredData {
    constructor() {
        this.isLive = true;
        this.data = {};
    }

    static get instance() {
        if (this._instance == null) {
            this._instance = new this();
        }

        return this._instance;
    }

    set live(value) {
        this.isLive = value;
    }

    setFallback(data) {
        this.data = data;
    }

    override(data) {
        this.data = Object.assign({}, this.data, data);
    }

    get(key) {
        if (!this.isLive) {
            return this.data[key];
        }

        if (key === "autoClosingBrackets") {
            return vscode.workspace.getConfiguration("editor").get(key);
        }

        const resolverValue = vscode.workspace.getConfiguration("phpResolver").get(key);
        if (resolverValue !== undefined) {
            return resolverValue;
        }

        return vscode.workspace.getConfiguration("php-docblocker").get(key);
    }
}

class PHPTypes {
    static get instance() {
        if (!this._instance) {
            this._instance = new this();
        }

        return this._instance;
    }

    getResolvedTypeHints(typeHint, classHead = null) {
        const parts = typeHint.split(/([|&])/);
        for (let i = 0; i < parts.length; i += 2) {
            if (parts[i] === "") {
                delete parts[i];
                delete parts[i + 1];
                continue;
            }

            parts[i] = this.getFullyQualifiedType(parts[i], classHead);
            parts[i] = this.getFormattedTypeByName(parts[i]);
        }

        return parts.join("");
    }

    getFullyQualifiedType(typeHint, classHead) {
        if (!classHead || !PHPStoredData.instance.get("qualifyClassNames")) {
            return typeHint;
        }

        const usePattern = /[\s;]?use\s+(?:(const|function)\s*)?([\s\S]*?)\s*;/gmi;
        let match;
        while ((match = usePattern.exec(classHead))) {
            const useType = match[1];
            const useStatement = match[2];

            if (useType) {
                continue;
            }

            const mappedClass = this.getClassesFromUse(useStatement)[typeHint];
            if (mappedClass !== undefined) {
                return mappedClass.charAt(0) === "\\" ? mappedClass : "\\" + mappedClass;
            }
        }

        return typeHint;
    }

    getClassesFromUse(useStatement) {
        let namespacePrefix;
        let classes;

        if (useStatement.indexOf("{") !== -1) {
            const openIndex = useStatement.indexOf("{");
            const closeIndex = (useStatement + "}").indexOf("}");
            namespacePrefix = useStatement.substring(0, openIndex).trim();
            classes = useStatement.substring(openIndex + 1, closeIndex).split(",");
        } else {
            namespacePrefix = "";
            classes = useStatement.split(",");
        }

        const map = {};
        for (let index = 0; index < classes.length; index += 1) {
            let className;
            let alias;
            let entry = classes[index].trim();

            if (entry === "") {
                continue;
            }

            entry = namespacePrefix + entry;
            [className, alias] = entry.split(/\s+as\s+/gmi, 2);

            if (alias === undefined || alias === "") {
                alias = className.substring(className.lastIndexOf("\\") + 1);
            }

            map[alias] = className;
        }

        return map;
    }

    getFormattedTypeByName(typeName) {
        switch (typeName) {
            case "bool":
            case "boolean":
                return PHPStoredData.instance.get("useShortNames") ? "bool" : "boolean";
            case "int":
            case "integer":
                return PHPStoredData.instance.get("useShortNames") ? "int" : "integer";
            default:
                return typeName;
        }
    }

    getTypeFromValue(value) {
        if (value.match(/^\s*(false|true)\s*$/i) !== null || value.match(/^\s*\!/i) !== null) {
            return this.getFormattedTypeByName("bool");
        }

        if (value.match(/^\s*([\d-]+)\s*$/) !== null) {
            return this.getFormattedTypeByName("int");
        }

        if (value.match(/^\s*([\d.-]+)\s*$/) !== null) {
            return "float";
        }

        if (value.match(/^\s*(["'])/) !== null || value.match(/^\s*<<</) !== null) {
            return "string";
        }

        if (value.match(/^\s*(array\(|\[)/) !== null) {
            return "array";
        }

        return this.getDefaultType();
    }

    getDefaultType() {
        return PHPStoredData.instance.get("defaultType");
    }
}

class PHPMethod extends BaseParser {
    constructor() {
        super(...arguments);
        this.pattern = /^\s*((.*)(protected|private|public))?(.*)?\s*function\s+&?([a-z0-9_]+)\s*\(([^{;]*)/im;
    }

    parse() {
        const parts = this.match();
        const block = new DocBlock("Undocumented function");
        block.template = PHPStoredData.instance.get("functionTemplate");

        const paramsPart = this.getEnclosed(parts[6], "(", ")");
        let classHead;

        if (paramsPart !== "") {
            const params = this.getSplitWithoutEnclosed(paramsPart);
            if (PHPStoredData.instance.get("qualifyClassNames")) {
                classHead = this.getClassHead();
            }

            for (let index = 0; index < params.length; index += 1) {
                const parameter = params[index].match(
                    /^\s*(?:(?:public|protected|private)\s+)?(?:readonly\s+)?(\?)?\s*([A-Za-z0-9_\\][A-Za-z0-9_\\|&]+)?\s*\&?((?:[.]{3})?\$[A-Za-z0-9_]+)\s*\=?\s*(.*)\s*/im
                );

                if (!parameter) {
                    continue;
                }

                let type = PHPTypes.instance.getDefaultType();

                if (parameter[2] != null) {
                    type = PHPTypes.instance.getResolvedTypeHints(parameter[2], classHead);
                }

                if (
                    (parameter[2] != null && parameter[1] === "?")
                    || (parameter[2] != null && parameter[4] != null && parameter[2] !== "mixed" && parameter[4] === "null")
                ) {
                    type += "|null";
                } else if (parameter[4] != null && parameter[4] !== "" && parameter[2] !== "mixed") {
                    type = PHPTypes.instance.getFormattedTypeByName(PHPTypes.instance.getTypeFromValue(parameter[4]));
                }

                block.params.push(new DocParam(type, parameter[3]));
            }
        }

        const returnMatch = this.signature.match(/.*\)\s*\:\s*(\?)?\s*([a-zA-Z_|0-9\\]+)\s*$/m);
        if (returnMatch != null) {
            returnMatch[2] = PHPTypes.instance.getResolvedTypeHints(returnMatch[2], this.getClassHead());
            block.return = returnMatch[1] === "?"
                ? PHPTypes.instance.getFormattedTypeByName(returnMatch[2]) + "|null"
                : PHPTypes.instance.getFormattedTypeByName(returnMatch[2]);
        } else {
            block.return = this.getReturnFromName(parts[5]);
        }

        return block;
    }

    getReturnFromName(name) {
        if (/^(is|has|can|should)(?:[A-Z0-9_]|$)/.test(name)) {
            return PHPTypes.instance.getFormattedTypeByName("bool");
        }

        switch (name) {
            case "__construct":
            case "__destruct":
            case "__set":
            case "__unset":
            case "__wakeup":
                return null;
            case "__isset":
                return PHPTypes.instance.getFormattedTypeByName("bool");
            case "__sleep":
            case "__debugInfo":
                return "array";
            case "__toString":
                return "string";
            default:
                return "void";
        }
    }
}

class PHPClass extends BaseParser {
    constructor() {
        super(...arguments);
        this.pattern = /^\s*(abstract|final)?\s*(class|trait|interface)\s+([a-z0-9_]+)\s*/i;
    }

    parse() {
        const parts = this.match();
        const block = new DocBlock("Undocumented " + parts[2]);
        block.template = PHPStoredData.instance.get("classTemplate");
        return block;
    }
}

class PHPVar extends BaseParser {
    constructor() {
        super(...arguments);
        this.pattern = /^\s*(static)?\s*(protected|private|public)\s+(static\s*)?(?:readonly\s*)?(\??\\?[a-zA-Z_\x7f-\xff][a-zA-Z0-9|_\x7f-\xff\\]+)?\s*(\$[A-Za-z0-9_]+)\s*\=?\s*([^;]*)/m;
    }

    parse() {
        const parts = this.match();
        const block = new DocBlock("Undocumented variable");
        block.template = PHPStoredData.instance.get("propertyTemplate");

        if (parts[4]) {
            const typeParts = parts[4].match(/(\?)?(.*)/m);
            let classHead;
            if (PHPStoredData.instance.get("qualifyClassNames")) {
                classHead = this.getClassHead();
            }

            let type = PHPTypes.instance.getResolvedTypeHints(typeParts[2], classHead);
            type = PHPTypes.instance.getFormattedTypeByName(type);
            if (typeParts[1] === "?") {
                type += "|null";
            }

            block.var = type;
        } else if (parts[6]) {
            block.var = PHPTypes.instance.getTypeFromValue(parts[6]);
        } else {
            block.var = PHPTypes.instance.getDefaultType();
        }

        return block;
    }
}

class DocBuilder {
    constructor(position, editor) {
        this.targetPosition = position.start;
        this.editor = editor;
    }

    autoDocument() {
        const method = new PHPMethod(this.targetPosition, this.editor);
        if (method.test()) {
            return method.parse().build();
        }

        const property = new PHPVar(this.targetPosition, this.editor);
        if (property.test()) {
            return property.parse().build();
        }

        const phpClass = new PHPClass(this.targetPosition, this.editor);
        if (phpClass.test()) {
            return phpClass.parse().build();
        }

        return new DocBlock().build(true);
    }
}

module.exports = DocBuilder;