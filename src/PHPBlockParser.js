let vscode = require('vscode');

var S = class {
    constructor(e, t) {
        this.type = e, this.name = t
    }
};
class DocBlock {
    constructor(e = "") {
        this.params = [];
        this.indentCharacter = " ";
        this.message = e
    }
    fromObject(e) {
        e.return !== void 0 && (this.return = e.return), e.var !== void 0 && (this.var = e.var), e.message !== void 0 && (this.message = e.message), e.params !== void 0 && Array.isArray(e.params) && e.params.forEach(t => {
            this.params.push(new S(t.type, t.name))
        })
    }
    build(e = !1) {
        let t = "",//PHPStoredData.instance.get("extra"),
            n = "",//PHPStoredData.instance.get("gap"),
            a = "",//PHPStoredData.instance.get("returnGap"),
            l = "",//PHPStoredData.instance.get("alignParams") ? PHPStoredData.instance.get("alignReturn") : !1,
            r = "",
            s = "",
            c = "",
            g = "",
            b = "";
        e && (n = !0, t = []), b = "${###" + (this.message != "" ? ":" : "") + this.message + "}";
        let T = this.getMaxParamLength(this.params, this.return);
        if (this.params.length && (c = "", this.params.forEach(u => {
            c != "" && (c += `
`);
            let h = u.type,
                f = u.name.replace("$", "\\$"),
                z = this.getParamAlignmentSpaces(T, f, h);
            c += "@param " + (l ? this.indentCharacter : "") + "${###:" + h + "} " + z.prepend + f + z.append;
            let I = PHPStoredData.instance.get("paramDescription");
            I === !0 ? c += "${###}" : typeof I == "string" && (c += "${###:" + I + "}")
        })), this.var) {
            s = "@var ${###:" + this.var + "}";
            let u = PHPStoredData.instance.get("varDescription");
            u === !0 ? s += " ${###}" : typeof u == "string" && (s += " ${###:" + u + "}")
        }
        if (this.return && (this.return != "void" || PHPStoredData.instance.get("returnVoid"))) {
            let u = this.getReturnAlignmentSpaces(T);
            r = "@return ${###:" + this.return + "}" + u.append;
            let h = PHPStoredData.instance.get("returnDescription");
            h === !0 ? r += "${###}" : typeof h == "string" && (r += "${###:" + h + "}")
        }
        Array.isArray(t) && t.length > 0 && (g = t.join(`
`));
        let parsedParts = [];
        for (let u in this.template) {
            let h = this.template[u],
                f;
            u == "message" && b ? (f = b, n && (h.gapAfter = !0)) :
                u == "var" && s ? f = s :
                    u == "return" && r ? (f = r, a && (h.gapBefore = !0)) :
                        u == "param" && c ? f = c :
                            u == "extra" && g ? f = g :
                                h.content !== void 0 && (f = h.content), f && h.gapBefore && parsedParts[parsedParts.length - 1] != "" && parsedParts.push(""), f && parsedParts.push(f), f && h.gapAfter && parsedParts.push("")
        }
        parsedParts[parsedParts.length - 1] == "" && parsedParts.pop();
        let snippetBuildString = parsedParts.join(`
`);
        let interpolateIndex = 0;
        snippetBuildString = snippetBuildString.replace(/###/gm, function () {
            return interpolateIndex++, interpolateIndex + ""
        });
        snippetBuildString = snippetBuildString.replace(/^$/gm, " *");
        snippetBuildString = snippetBuildString.replace(/^(?!(\s\*|\/\*))/gm, " * $1");
        PHPStoredData.instance.get("autoClosingBrackets") == "never" ? snippetBuildString = `
` + snippetBuildString + `
 */` : snippetBuildString = `/**
` + snippetBuildString + `
 */`;
        return new vscode.SnippetString(snippetBuildString)
    }
    set template(e) {
        this._template = e
    }
    get template() {
        return this._template == null ?
            {
                message:
                    {},
                var:
                    {},
                param:
                    {},
                return:
                    {},
                extra:
                    {}
            } : this._template
    }
    getMaxParamLength(e, t) {
        let n = true,//PHPStoredData.instance.get("alignParams"),
            a = !1,//n ? PHPStoredData.instance.get("alignReturn") : !1,
            i = 0,
            l = 0;
        return e.length && n && e.forEach(r => {
            let s = r.type;
            s.length > i && (i = s.length);
            let c = r.name.replace("$", "\\$");
            c.length > l && (l = c.length)
        }), t && (t != "void" /*|| PHPStoredData.instance.get("returnVoid")*/) && a && t.length > i && (i = t.length),
        {
            type: i,
            name: l
        }
    }
    getParamAlignmentSpaces(e, t, n) {
        let a = true,//PHPStoredData.instance.get("alignParams"),
            i = "",//PHPStoredData.instance.get("paramDescription"),
            l = "",
            r = "";
        return a && (l = Array(e.type - n.length).fill(this.indentCharacter).join(""), r = Array(1 + e.name - t.length).fill(this.indentCharacter).join("")),
        {
            append: i ? a ? r : this.indentCharacter : "",
            prepend: l
        }
    }
    getReturnAlignmentSpaces(e) {
        let n = true, //PHPStoredData.instance.get("alignParams") ? PHPStoredData.instance.get("alignReturn") : !1,
            a = "",//PHPStoredData.instance.get("returnDescription"),
            i = "";
        return n && (i = Array(1 + e.type - this.return.length).fill(this.indentCharacter).join("") + Array(e.name).fill(this.indentCharacter).join("")),
        {
            append: a ? n ? i : this.indentCharacter : "",
            prepend: ""
        }
    }
};

class BaseParser {
    constructor(position, editor) {
        this.signatureEnd = /[\{;]/;
        this.position = position, this.editor = editor, this.setSignature(this.getBlock(position, this.signatureEnd))
    }
    test() {
        return this.pattern.test(this.signature)
    }
    match() {
        return this.signature.match(this.pattern)
    }
    setSignature(block) {
        this.signature = block;
    }
    getBlock(position, end) {
        let n = position.line + 1,
            a = this.editor.document.lineAt(n).text,
            i = a.search(/[^\s]/);
        if (i === -1) return "";
        let l = new vscode.Position(position.line + 1, i);
        for (; !end.test(a);) n++, a = this.editor.document.lineAt(n).text;
        let r = new vscode.Position(n, a.search(end)),
            s = new vscode.Range(l, r);
        return this.editor.document.getText(s)
    }
    getEnclosed(e, t, n) {
        let a = 0,
            i = e.split(""),
            l = 0;
        for (let r = 0; r < i.length; r++) {
            let s = i[r];
            if (s == n && a == 0) {
                l = r;
                break
            }
            else s == n ? a-- : s == t && a++;
            l = r
        }
        return e.substr(0, l)
    }
    getSplitWithoutEnclosed(e, t = ",") {
        let n = new Array,
            a = e.split(""),
            i = ["{", "(", "["],
            l = ["}", ")", "]"],
            r = 0,
            s = 0,
            c = 0;
        for (let b = 0; b < a.length; b++) {
            let T = a[b];
            if (T === t && b === a.length - 1) break;
            if (T === t && r === 0) {
                c = b, n.push(e.substr(s, c - s)), s = b + 1;
                continue
            }
            else i.indexOf(T) >= 0 ? r++ : l.indexOf(T) >= 0 && r--;
            c = b
        }
        return e.substr(s, c - s + 1).match(/^\s*$/) || n.push(e.substr(s, c - s + 1)), n
    }
    getClassHead() {
        if (this.classHead === void 0) {
            let e = this.editor.document.lineCount < 300 ? this.editor.document.lineCount - 1 : 300,
                t = this.editor.document.getText(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(e, 0))),
                a = /\s*(abstract|final)?\s*(class|trait|interface)/gm.exec(t);
            if (a === null) this.classHead = null;
            else {
                let i = this.editor.document.positionAt(a.index),
                    l = new vscode.Range(new vscode.Position(0, 0), i);
                this.classHead = this.editor.document.getText(l)
            }
        }
        return this.classHead
    }
};
class PHPStoredData {
    constructor() {
        this.isLive = !0
    }
    static get instance() {
        return this._instance == null && (this._instance = new this), this._instance
    }
    set live(e) {
        this.isLive = e
    }
    setFallback(e) {
        this.data = e
    }
    override(e) {
        this.data = B(B(
            {}, this.data), e)
    }
    get(e) {
        return this.isLive ? e === "autoClosingBrackets" ? vscode.workspace.getConfiguration("editor").get(e) : vscode.workspace.getConfiguration("php-docblocker").get(e) : this.data[e]
    }
};
class PHPTypes {
    static get instance() {
        return this._instance || (this._instance = new this)
    }
    getResolvedTypeHints(e, t = null) {
        let n = e.split(/([|&])/);
        for (let a = 0; a < n.length; a += 2) {
            if (n[a] === "") {
                delete n[a], delete n[a + 1];
                continue
            }
            n[a] = this.getFullyQualifiedType(n[a], t), n[a] = this.getFormattedTypeByName(n[a])
        }
        return n.join("")
    }
    getFullyQualifiedType(e, t) {
        if (!t || !PHPStoredData.instance.get("qualifyClassNames")) return e;
        let n = /[\s;]?use\s+(?:(const|function)\s*)?([\s\S]*?)\s*;/gmi,
            a;
        for (; a = n.exec(t);) {
            let i = a[1],
                l = a[2];
            if (i) continue;
            let r = this.getClassesFromUse(l)[e];
            if (r !== void 0) return r.charAt(0) != "\\" && (r = "\\" + r), r
        }
        return e
    }
    getClassesFromUse(e) {
        let t, n;
        if (e.indexOf("{") !== -1) {
            let l = e.indexOf("{"),
                r = (e + "}").indexOf("}");
            t = e.substring(0, l).trim(), n = e.substring(l + 1, r).split(",")
        }
        else t = "", n = e.split(",");
        var i = {};
        for (let l = 0; l < n.length; l++) {
            let r, s = n[l].trim();
            s !== "" && (s = t + s, [s, r] = s.split(/\s+as\s+/gmi, 2), (r === void 0 || r === "") && (r = s.substring(s.lastIndexOf("\\") + 1)), i[r] = s)
        }
        return i
    }
    getFormattedTypeByName(e) {
        switch (e) {
            case "bool":
            case "boolean":
                return PHPStoredData.instance.get("useShortNames") ? "bool" : "boolean";
            case "int":
            case "integer":
                return PHPStoredData.instance.get("useShortNames") ? "int" : "integer";
            default:
                return e
        }
    }
    getTypeFromValue(e) {
        let t;
        return e.match(/^\s*(false|true)\s*$/i) !== null || e.match(/^\s*\!/i) !== null ? this.getFormattedTypeByName("bool") : e.match(/^\s*([\d-]+)\s*$/) !== null ? this.getFormattedTypeByName("int") : e.match(/^\s*([\d.-]+)\s*$/) !== null ? "float" : e.match(/^\s*(["'])/) !== null || e.match(/^\s*<<</) !== null ? "string" : e.match(/^\s*(array\(|\[)/) !== null ? "array" : this.getDefaultType()
    }
    getDefaultType() {
        return PHPStoredData.instance.get("defaultType")
    }
};
class PHPMethod extends BaseParser {
    constructor() {
        super(...arguments);
        this.pattern = /^\s*((.*)(protected|private|public))?(.*)?\s*function\s+&?([a-z0-9_]+)\s*\(([^{;]*)/im
    }
    parse() {
        let e = this.match(),
            t = new DocBlock("Undocumented function");
        t.template = PHPStoredData.instance.get("functionTemplate");
        let n = this.getEnclosed(e[6], "(", ")"),
            a;
        if (n != "") {
            let r = this.getSplitWithoutEnclosed(n);
            PHPStoredData.instance.get("qualifyClassNames") && (a = this.getClassHead());
            for (let s = 0; s < r.length; s++) {
                let g = r[s].match(/^\s*(?:(?:public|protected|private)\s+)?(?:readonly\s+)?(\?)?\s*([A-Za-z0-9_\\][A-Za-z0-9_\\|&]+)?\s*\&?((?:[.]{3})?\$[A-Za-z0-9_]+)\s*\=?\s*(.*)\s*/im);
                var i = PHPTypes.instance.getDefaultType();
                g[2] != null && (i = PHPTypes.instance.getResolvedTypeHints(g[2], a)), g[2] != null && g[1] === "?" || g[2] != null && g[4] != null && g[2] != "mixed" && g[4] == "null" ? i += "|null" : g[4] != null && g[4] != "" && g[2] != "mixed" && (i = PHPTypes.instance.getFormattedTypeByName(PHPTypes.instance.getTypeFromValue(g[4]))), t.params.push(new S(i, g[3]))
            }
        }
        let l = this.signature.match(/.*\)\s*\:\s*(\?)?\s*([a-zA-Z_|0-9\\]+)\s*$/m);
        return l != null ? (l[2] = PHPTypes.instance.getResolvedTypeHints(l[2], this.getClassHead()), t.return = l[1] === "?" ? PHPTypes.instance.getFormattedTypeByName(l[2]) + "|null" : PHPTypes.instance.getFormattedTypeByName(l[2])) : t.return = this.getReturnFromName(e[5]), t
    }
    getReturnFromName(e) {
        if (/^(is|has|can|should)(?:[A-Z0-9_]|$)/.test(e)) return PHPTypes.instance.getFormattedTypeByName("bool");
        switch (e) {
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
                return "string"
        }
        return "void"
    }
};
class PHPClass extends BaseParser {
    constructor() {
        super(...arguments);
        this.pattern = /^\s*(abstract|final)?\s*(class|trait|interface)\s+([a-z0-9_]+)\s*/i
    }
    parse() {
        let parts = this.match(),
            template = new DocBlock("Undocumented " + parts[2]);
        return template.template = this.template, template;
    }
    get template() {
        return this._template == null ?
            {
                message:
                {
                    gapAfter: true
                },
                extra:
                    {}
            } : this._template
    }
};
class PHPVar extends BaseParser {
    constructor() {
        super(...arguments);
        this.pattern = /^\s*(static)?\s*(protected|private|public)\s+(static\s*)?(?:readonly\s*)?(\??\\?[a-zA-Z_\x7f-\xff][a-zA-Z0-9|_\x7f-\xff\\]+)?\s*(\$[A-Za-z0-9_]+)\s*\=?\s*([^;]*)/m
    }
    parse() {
        let e = this.match(),
            t = new DocBlock("Undocumented variable");
            // m = new PHPTypes();
        /*if (t.template = PHPStoredData.instance.get("propertyTemplate"), e[4]) {
            let n = e[4].match(/(\?)?(.*)/m),
                a;
            PHPStoredData.instance.get("qualifyClassNames") && (a = this.getClassHead());
            let i = PHPTypes.instance.getResolvedTypeHints(n[2], a);
            i = PHPTypes.instance.getFormattedTypeByName(i), n[1] === "?" && (i += "|null"), t.var = i
        }
        else */e[6] ? t.var = PHPTypes.instance.getTypeFromValue(e[6]) : t.var = PHPTypes.instance.getDefaultType();
        return t
    }
};
class DocBuilder {
    constructor(position, editor) {
        this.targetPosition = position.start, this.editor = editor
    }
    autoDocument() {

        let phpMethod = new PHPMethod(this.targetPosition, this.editor);
        if (phpMethod.test()) return phpMethod.parse().build();

        let phpVar = new PHPVar(this.targetPosition, this.editor);
        if (phpVar.test()) return phpVar.parse().build();

        let phpClass = new PHPClass(this.targetPosition, this.editor);
        return phpClass.test() ?
            phpClass.parse().build() :
            new DocBlock().build(!0)
    }
};

module.exports = DocBuilder;