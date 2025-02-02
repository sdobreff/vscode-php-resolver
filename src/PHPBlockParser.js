let vscode = require('vscode');

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
        let t = "",//o.instance.get("extra"),
            n = "",//o.instance.get("gap"),
            a = "",//o.instance.get("returnGap"),
            l = "",//o.instance.get("alignParams") ? o.instance.get("alignReturn") : !1,
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
            let I = o.instance.get("paramDescription");
            I === !0 ? c += "${###}" : typeof I == "string" && (c += "${###:" + I + "}")
        })), this.var) {
            s = "@var ${###:" + this.var + "}";
            let u = o.instance.get("varDescription");
            u === !0 ? s += " ${###}" : typeof u == "string" && (s += " ${###:" + u + "}")
        }
        if (this.return && (this.return != "void" || o.instance.get("returnVoid"))) {
            let u = this.getReturnAlignmentSpaces(T);
            r = "@return ${###:" + this.return + "}" + u.append;
            let h = o.instance.get("returnDescription");
            h === !0 ? r += "${###}" : typeof h == "string" && (r += "${###:" + h + "}")
        }
        Array.isArray(t) && t.length > 0 && (g = t.join(`
`));
        let P = [];
        for (let u in this.template) {
            let h = this.template[u],
                f;
            u == "message" && b ? (f = b, n && (h.gapAfter = !0)) : u == "var" && s ? f = s : u == "return" && r ? (f = r, a && (h.gapBefore = !0)) : u == "param" && c ? f = c : u == "extra" && g ? f = g : h.content !== void 0 && (f = h.content), f && h.gapBefore && P[P.length - 1] != "" && P.push(""), f && P.push(f), f && h.gapAfter && P.push("")
        }
        P[P.length - 1] == "" && P.pop();
        let $ = P.join(`
`),
            H = 0;
        return $ = $.replace(/###/gm, function () {
            return H++, H + ""
        }), $ = $.replace(/^$/gm, " *"), $ = $.replace(/^(?!(\s\*|\/\*))/gm, " * $1"), /*o.instance.get("autoClosingBrackets") == */"never" ? $ = `
` + $ + `
 */` : $ = `/**
` + $ + `
 */`, new vscode.SnippetString($)
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
        let n = true,//o.instance.get("alignParams"),
            a = !1,//n ? o.instance.get("alignReturn") : !1,
            i = 0,
            l = 0;
        return e.length && n && e.forEach(r => {
            let s = r.type;
            s.length > i && (i = s.length);
            let c = r.name.replace("$", "\\$");
            c.length > l && (l = c.length)
        }), t && (t != "void" /*|| o.instance.get("returnVoid")*/) && a && t.length > i && (i = t.length),
        {
            type: i,
            name: l
        }
    }
    getParamAlignmentSpaces(e, t, n) {
        let a = true,//o.instance.get("alignParams"),
            i = "",//o.instance.get("paramDescription"),
            l = "",
            r = "";
        return a && (l = Array(e.type - n.length).fill(this.indentCharacter).join(""), r = Array(1 + e.name - t.length).fill(this.indentCharacter).join("")),
        {
            append: i ? a ? r : this.indentCharacter : "",
            prepend: l
        }
    }
    getReturnAlignmentSpaces(e) {
        let n = true, //o.instance.get("alignParams") ? o.instance.get("alignReturn") : !1,
            a = "",//o.instance.get("returnDescription"),
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

class PHPClass extends BaseParser {
    constructor() {
        super(...arguments);
        this.pattern = /^\s*(abstract|final)?\s*(class|trait|interface)\s+([a-z0-9_]+)\s*/i
    }
    parse() {
        let e = this.match(),
            t = new DocBlock("Undocumented " + e[2]);
        return t.template = 'k', t
    }
};

class DocBuilder {
    constructor(position, editor) {
        this.targetPosition = position.start, this.editor = editor
    }
    autoDocument() {
        let phpClass = new PHPClass(this.targetPosition, this.editor);
        return phpClass.test() ? phpClass.parse().build() : new DocBlock().build(!0)
    }
};

module.exports = DocBuilder;