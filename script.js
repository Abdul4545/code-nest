/* =========================================================================
   MyCodeNest — Application Logic
   Sections:
     1. Constants & State
     2. DOM References
     3. Persistence (localStorage)
     4. Default Project
     5. Syntax Highlighting (lightweight, regex based)
     6. Editor (line numbers, active line, tab/indent, auto-close brackets)
     7. File Tabs / Explorer
     8. Live Preview (virtual-file compilation into iframe srcdoc)
     9. Toolbar Actions (run, preview toggle, copy, download, rename, reset)
    10. Settings Panel
    11. Theme (light / dark / auto)
    12. Status Bar
    13. Resizable Preview Divider
    14. Mobile Drawer & Preview Modal
    15. Keyboard Shortcuts
    16. Toast Notifications
    17. Init
   ========================================================================= */

(() => {
  'use strict';

  /* --------------------------- 1. CONSTANTS & STATE --------------------------- */

  const STORAGE_KEY = 'MyCodeNest.project.v1';
  const DEBOUNCE_MS = 220;

  /** @type {{html:string, css:string, js:string}} */
  let files = { html: '', css: '', js: '' };

  let state = {
    activeFile: 'html',
    theme: 'dark',              // 'dark' | 'light' | 'auto'
    previewOpen: false,
    previewWidth: 480,
    projectName: 'My Project',
    fontSize: 14,
    tabSize: 4,
    wordWrap: true,
  };

  let renderTimer = null;
  let saveTimer = null;

  /* --------------------------- 2. DOM REFERENCES --------------------------- */

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const body = document.body;
  const workspace = $('.workspace');

  const codeInput = $('#codeInput');
  const highlightLayer = $('#highlightLayer');
  const highlightCode = $('#highlightCode');
  const gutter = $('#gutter');
  const activeLineEl = $('#activeLine');

  const fileTree = $('#fileTree');
  const tabsBar = $('.tabs');

  const previewFrame = $('#previewFrame');
  const mobilePreviewFrame = $('#mobilePreviewFrame');
  const previewConsoleBody = $('#previewConsoleBody');
  const mobilePreviewConsoleBody = $('#mobilePreviewConsoleBody');
  const previewPanel = $('#previewPanel');
  const mobilePreviewModal = $('#mobilePreviewModal');

  const runBtn = $('#runBtn');
  const formatBtn = $('#formatBtn');
  const previewToggleBtn = $('#previewToggleBtn');
  const previewCloseBtn = $('#previewCloseBtn');
  const refreshPreviewBtn = $('#refreshPreviewBtn');
  const mobilePreviewCloseBtn = $('#mobilePreviewCloseBtn');
  const previewConsoleClearBtn = $('#previewConsoleClearBtn');
  const mobilePreviewConsoleClearBtn = $('#mobilePreviewConsoleClearBtn');

  const copyBtn = $('#copyBtn');
  const downloadBtn = $('#downloadBtn');
  const resetBtn = $('#resetBtn');
  const settingsBtn = $('#settingsBtn');

  const themeToggle = $('#themeToggle');
  const drawerToggle = $('#drawerToggle');
  const explorer = $('#explorer');
  const explorerCloseBtn = $('#explorerCloseBtn');
  const drawerBackdrop = $('#drawerBackdrop');

  const projectNameInput = $('#projectNameInput');
  const explorerProjectLabel = $('#explorerProjectLabel');

  const resizer = $('#resizer');

  const statusCurrentFile = $('#statusCurrentFile');
  const statusCursor = $('#statusCursor');
  const statusChars = $('#statusChars');
  const statusTheme = $('#statusTheme');
  const savedIndicator = $('#savedIndicator');

  const settingsBackdrop = $('#settingsBackdrop');
  const settingsCloseBtn = $('#settingsCloseBtn');
  const settingsDoneBtn = $('#settingsDoneBtn');
  const resetSettingsBtn = $('#resetSettingsBtn');
  const fontSizeRange = $('#fontSizeRange');
  const fontSizeValue = $('#fontSizeValue');
  const tabSizeRange = $('#tabSizeRange');
  const tabSizeValue = $('#tabSizeValue');
  const wordWrapToggle = $('#wordWrapToggle');
  const themeSelect = $('#themeSelect');
  const previewWidthRange = $('#previewWidthRange');
  const previewWidthValue = $('#previewWidthValue');

  const toast = $('#toast');

  const FILE_META = {
    html: { label: 'index.html', lang: 'html' },
    css:  { label: 'style.css',  lang: 'css'  },
    js:   { label: 'script.js',  lang: 'js'   },
  };

  /* --------------------------- 3. PERSISTENCE --------------------------- */

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data.files) files = data.files;
      if (data.state) state = { ...state, ...data.state };
      return true;
    } catch (e) {
      console.warn('MyCodeNest: failed to load saved project, starting fresh.', e);
      return false;
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ files, state }));
      flashSaved();
    } catch (e) {
      console.warn('MyCodeNest: failed to save project.', e);
    }
  }

  function scheduleSave() {
    savedIndicator.classList.remove('status-chip--saved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToStorage, 500);
  }

  function flashSaved() {
    savedIndicator.classList.add('status-chip--saved');
  }

  /* --------------------------- 4. DEFAULT PROJECT --------------------------- */

  function defaultFiles() {
    return {
      html:
`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Hello World</h1>
  <script src="script.js"><\/script>
</body>
</html>`,
      css:
`body {
  font-family: sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  margin: 0;
  background: #f4f4f9;
}

h1 {
  color: #7c6ff2;
}`,
      js:
`// Welcome to MyCodeNest!
// This is script.js — write JavaScript here.

console.log("Hello from MyCodeNest");`,
    };
  }

  function resetProject() {
    files = defaultFiles();
    state.activeFile = 'html';
    state.projectName = 'My Project';
    projectNameInput.value = state.projectName;
    explorerProjectLabel.textContent = state.projectName;
    setActiveFile('html');
    loadFileIntoEditor();
    renderPreview();
    saveToStorage();
    showToast('Project reset to default ✓');
  }

  /* --------------------------- 5. SYNTAX HIGHLIGHTING --------------------------- */

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // NOTE: each highlighter below runs as a SINGLE regex.replace() pass over the
  // original escaped source. Doing multiple sequential passes (as an earlier
  // version did) is unsafe: a later pass can accidentally re-match text that
  // an earlier pass already inserted (e.g. matching `class="tok-tag"` inside
  // the very <span> the tag pass just produced). A single alternation-based
  // pass guarantees each character of the source is only ever considered once.

  function highlightHTML(src) {
    const esc = escapeHtml(src);
    const re = /(&lt;!--[\s\S]*?--&gt;)|(&lt;\/?)([a-zA-Z][\w:-]*)((?:\s+[^&]*?)?)(\/?&gt;)/g;
    return esc.replace(re, (match, comment, openBracket, tagName, attrs, closeBracket) => {
      if (comment) return `<span class="tok-comment">${comment}</span>`;
      const attrsHtml = attrs.replace(
        /([a-zA-Z_:][\w:-]*)(\s*=\s*)("[^"]*"|'[^']*')/g,
        '<span class="tok-attr">$1</span>$2<span class="tok-string">$3</span>'
      );
      return `${openBracket}<span class="tok-tag">${tagName}</span>${attrsHtml}${closeBracket}`;
    });
  }

  function highlightCSS(src) {
    const esc = escapeHtml(src);
    const re = /(\/\*[\s\S]*?\*\/)|([.#]?[a-zA-Z][\w-]*)(?=\s*\{)|([a-zA-Z-]+)(\s*:\s*)([^;{}\n]+)(;?)/g;
    return esc.replace(re, (match, comment, selector, prop, colon, value, semi) => {
      if (comment) return `<span class="tok-comment">${comment}</span>`;
      if (selector) return `<span class="tok-selector">${selector}</span>`;
      if (prop) return `<span class="tok-property">${prop}</span>${colon}<span class="tok-value">${value}</span>${semi}`;
      return match;
    });
  }

  const JS_KEYWORDS = 'const|let|var|function|return|if|else|for|while|class|new|import|export|default|from|of|in|try|catch|typeof|await|async|break|continue|switch|case|null|undefined|true|false|this';

  function highlightJS(src) {
    const esc = escapeHtml(src);
    const re = new RegExp(
      '(\\/\\/.*$)' +                                   // 1: line comment
      "|('[^'\\n]*'|\"[^\"\\n]*\"|`[^`]*`)" +            // 2: string
      '|\\b(' + JS_KEYWORDS + ')\\b' +                   // 3: keyword
      '|\\b([a-zA-Z_$][\\w$]*)(?=\\()' +                 // 4: function call
      '|\\b(\\d+(?:\\.\\d+)?)\\b',                       // 5: number
      'gm'
    );
    return esc.replace(re, (match, comment, string, keyword, func, number) => {
      if (comment) return `<span class="tok-comment">${comment}</span>`;
      if (string) return `<span class="tok-string">${string}</span>`;
      if (keyword) return `<span class="tok-keyword">${keyword}</span>`;
      if (func) return `<span class="tok-func">${func}</span>`;
      if (number) return `<span class="tok-number">${number}</span>`;
      return match;
    });
  }

  function highlight(src, lang) {
    if (lang === 'html') return highlightHTML(src);
    if (lang === 'css') return highlightCSS(src);
    if (lang === 'js') return highlightJS(src);
    return escapeHtml(src);
  }

  function updateHighlight() {
    const lang = FILE_META[state.activeFile].lang;
    highlightCode.innerHTML = highlight(codeInput.value, lang) + '\n';
  }

  /* --------------------------- 6. EDITOR --------------------------- */

  function updateGutter() {
    const lineCount = codeInput.value.split('\n').length;
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= lineCount; i++) {
      const div = document.createElement('div');
      div.textContent = i;
      frag.appendChild(div);
    }
    gutter.innerHTML = '';
    gutter.appendChild(frag);
  }

  function updateActiveLine() {
    const upToCursor = codeInput.value.slice(0, codeInput.selectionStart);
    const lineIndex = upToCursor.split('\n').length - 1;
    const lineHeight = state.fontSize * 1.65;
    activeLineEl.style.transform = `translateY(${14 + lineIndex * lineHeight}px)`;
  }

  function syncScroll() {
    highlightLayer.scrollTop = codeInput.scrollTop;
    highlightLayer.scrollLeft = codeInput.scrollLeft;
    gutter.scrollTop = codeInput.scrollTop;
  }

  function updateStatusCursor() {
    const upToCursor = codeInput.value.slice(0, codeInput.selectionStart);
    const lines = upToCursor.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    statusCursor.textContent = `Ln ${line}, Col ${col}`;
    statusChars.textContent = `${codeInput.value.length} chars`;
  }

  const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
  const CLOSERS = new Set(Object.values(PAIRS));

  // Elements that never take a closing tag (so we never auto-close them).
  const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ]);

  /**
   * Looks at the text immediately before `pos` and, if it ends in a complete
   * HTML tag (e.g. "...<div class=\"a\">"), returns info about that tag.
   * Used by auto-close-tag, smart-indent-on-Enter, and tag-aware Backspace.
   */
  function getTagEndingAt(value, pos) {
    const before = value.slice(0, pos);
    const m = before.match(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*)?)>$/);
    if (!m) return null;
    const isClosing = m[1] === '/';
    const tagName = m[2];
    const attrPart = m[3] || '';
    const isSelfClosing = /\/\s*$/.test(attrPart);
    const isVoid = VOID_ELEMENTS.has(tagName.toLowerCase());
    return { fullMatch: m[0], isClosing, tagName, isSelfClosing, isVoid };
  }

  function handleEditorKeydown(e) {
    const ta = codeInput;

    // Auto-close HTML tags: typing the ">" that completes an opening tag
    // immediately inserts the matching "</tag>" and leaves the cursor
    // between them, e.g. "<div>|</div>".
    if (e.key === '>' && state.activeFile === 'html' && !e.ctrlKey && !e.metaKey) {
      const start = ta.selectionStart, end = ta.selectionEnd;
      if (start === end) {
        const tagInfo = getTagEndingAt(ta.value.slice(0, start) + '>', start + 1);
        if (tagInfo && !tagInfo.isClosing && !tagInfo.isSelfClosing && !tagInfo.isVoid) {
          e.preventDefault();
          insertText('>' + `</${tagInfo.tagName}>`);
          ta.selectionStart = ta.selectionEnd = start + 1;
          onEditorInput();
          return;
        }
      }
    }

    // Tab -> insert spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const spaces = ' '.repeat(state.tabSize);
      const start = ta.selectionStart, end = ta.selectionEnd;
      if (start !== end && ta.value.slice(start, end).includes('\n')) {
        indentSelection(e.shiftKey);
      } else if (e.shiftKey) {
        outdentAtCursor();
      } else {
        document.execCommand && insertText(spaces);
      }
      onEditorInput();
      return;
    }

    // Enter -> auto indentation
    if (e.key === 'Enter') {
      const start = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
      const currentLine = ta.value.slice(lineStart, start);
      const indentMatch = currentLine.match(/^[ \t]*/);
      const baseIndent = indentMatch ? indentMatch[0] : '';
      let indent = baseIndent;
      const prevChar = ta.value[start - 1];
      const nextChar = ta.value[start];

      // In HTML, only indent the next line if we just finished a real
      // opening tag (not a closing tag, not self-closing, not void).
      const htmlTagInfo = state.activeFile === 'html' ? getTagEndingAt(ta.value, start) : null;
      const htmlOpensBlock = htmlTagInfo && !htmlTagInfo.isClosing && !htmlTagInfo.isSelfClosing && !htmlTagInfo.isVoid;

      if (prevChar === '{' || prevChar === '[' || htmlOpensBlock) {
        indent += ' '.repeat(state.tabSize);
      }

      e.preventDefault();

      // Expand "<div>|</div>" -> "<div>\n  |\n</div>", same idea as bracket pairs.
      const htmlTagPair = htmlTagInfo && htmlOpensBlock &&
        ta.value.slice(start).startsWith(`</${htmlTagInfo.tagName}>`);

      if (htmlTagPair || (PAIRS[prevChar] && PAIRS[prevChar] === nextChar && (prevChar === '{' || prevChar === '[' || prevChar === '('))) {
        insertText('\n' + indent + '\n' + baseIndent);
        ta.selectionStart = ta.selectionEnd = start + 1 + indent.length;
      } else {
        insertText('\n' + indent);
      }
      onEditorInput();
      return;
    }

    // Auto-close brackets/quotes
    if (PAIRS[e.key] && !e.ctrlKey && !e.metaKey) {
      const start = ta.selectionStart, end = ta.selectionEnd;
      if (start !== end) {
        // wrap selection
        e.preventDefault();
        const selected = ta.value.slice(start, end);
        insertText(e.key + selected + PAIRS[e.key]);
        ta.selectionStart = start + 1;
        ta.selectionEnd = start + 1 + selected.length;
        onEditorInput();
        return;
      }
      const nextChar = ta.value[start];
      if ((e.key === '"' || e.key === "'" || e.key === '`') && nextChar === e.key) {
        e.preventDefault();
        ta.selectionStart = ta.selectionEnd = start + 1;
        return;
      }
      e.preventDefault();
      insertText(e.key + PAIRS[e.key]);
      ta.selectionStart = ta.selectionEnd = start + 1;
      onEditorInput();
      return;
    }

    // Skip over auto-closed character
    if (CLOSERS.has(e.key)) {
      const start = ta.selectionStart;
      if (ta.value[start] === e.key) {
        e.preventDefault();
        ta.selectionStart = ta.selectionEnd = start + 1;
        return;
      }
    }

    // Backspace removes matching empty pair
    if (e.key === 'Backspace') {
      const start = ta.selectionStart, end = ta.selectionEnd;
      if (start === end && start > 0) {
        const prevChar = ta.value[start - 1];
        const nextChar = ta.value[start];
        if (PAIRS[prevChar] === nextChar) {
          e.preventDefault();
          ta.value = ta.value.slice(0, start - 1) + ta.value.slice(start + 1);
          ta.selectionStart = ta.selectionEnd = start - 1;
          onEditorInput();
          return;
        }
        if (state.activeFile === 'html' && prevChar === '>') {
          const tagInfo = getTagEndingAt(ta.value, start);
          if (tagInfo && !tagInfo.isClosing && !tagInfo.isSelfClosing && !tagInfo.isVoid) {
            const closeTag = `</${tagInfo.tagName}>`;
            if (ta.value.slice(start).startsWith(closeTag)) {
              e.preventDefault();
              const newStart = start - tagInfo.fullMatch.length;
              ta.value = ta.value.slice(0, newStart) + ta.value.slice(start + closeTag.length);
              ta.selectionStart = ta.selectionEnd = newStart;
              onEditorInput();
              return;
            }
          }
        }
      }
    }
  }

  function insertText(text) {
    const ta = codeInput;
    const start = ta.selectionStart, end = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
  }

  function indentSelection(outdent) {
    const ta = codeInput;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const value = ta.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd);
    const spaces = ' '.repeat(state.tabSize);
    let newBlock;
    if (outdent) {
      const re = new RegExp('^ {1,' + state.tabSize + '}');
      newBlock = block.split('\n').map(l => l.replace(re, '')).join('\n');
    } else {
      newBlock = block.split('\n').map(l => spaces + l).join('\n');
    }
    ta.value = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
    ta.selectionStart = lineStart;
    ta.selectionEnd = lineStart + newBlock.length;
  }

  function outdentAtCursor() {
    const ta = codeInput;
    const start = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    const re = new RegExp('^ {1,' + state.tabSize + '}');
    const line = ta.value.slice(lineStart);
    const match = line.match(re);
    if (match) {
      ta.value = ta.value.slice(0, lineStart) + line.replace(re, '');
      ta.selectionStart = ta.selectionEnd = Math.max(lineStart, start - match[0].length);
    }
  }

  function onEditorInput() {
    files[state.activeFile] = codeInput.value;
    updateHighlight();
    updateGutter();
    updateActiveLine();
    updateStatusCursor();
    syncScroll();
    scheduleSave();
    debounceRender();
  }

  function debounceRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, DEBOUNCE_MS);
  }

  function loadFileIntoEditor() {
    codeInput.value = files[state.activeFile];
    updateHighlight();
    updateGutter();
    updateActiveLine();
    updateStatusCursor();
    applyEditorSettings();
  }

  function applyEditorSettings() {
    document.documentElement.style.setProperty('--editor-font-size', state.fontSize + 'px');
    document.documentElement.style.setProperty('--editor-tab-size', state.tabSize);
    codeInput.classList.toggle('wrap-on', state.wordWrap);
    highlightLayer.classList.toggle('wrap-on', state.wordWrap);
    updateActiveLine();
  }

  /* --------------------------- 6b. CODE FORMATTER --------------------------- */
  /* Lightweight, dependency-free "Format" — reflows indentation for the
     current file. HTML is rebuilt from tokens (tags/text); CSS and JS keep
     their existing line breaks and are re-indented by bracket depth. This
     is intentionally simple rather than a full parser, which fits a
     beginner-focused editor. */

  function formatHTML(src, indentUnit) {
    const tokens = (src.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || [])
      .map(t => (t.startsWith('<') ? t : t.trim()))
      .filter(t => t !== '');

    const parseTag = (raw) => {
      const isComment = /^<!--/.test(raw);
      const isDoctype = /^<!doctype/i.test(raw);
      const isClosing = /^<\//.test(raw);
      const isSelfClosing = /\/\s*>$/.test(raw);
      const m = raw.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
      const name = m ? m[1].toLowerCase() : '';
      return { isComment, isDoctype, isClosing, isSelfClosing, name };
    };

    let depth = 0;
    const lines = [];

    for (let i = 0; i < tokens.length; i++) {
      const raw = tokens[i];

      if (!raw.startsWith('<')) {
        lines.push(indentUnit.repeat(depth) + raw);
        continue;
      }

      const info = parseTag(raw);

      if (info.isComment || info.isDoctype) {
        lines.push(indentUnit.repeat(depth) + raw);
        continue;
      }

      if (info.isClosing) {
        depth = Math.max(0, depth - 1);
        lines.push(indentUnit.repeat(depth) + raw);
        continue;
      }

      if (info.isSelfClosing || VOID_ELEMENTS.has(info.name)) {
        lines.push(indentUnit.repeat(depth) + raw);
        continue;
      }

      // Collapse "<tag>text</tag>" or "<tag></tag>" onto a single line.
      const next1 = tokens[i + 1];
      const next2 = tokens[i + 2];
      if (next1 !== undefined && next1.startsWith('<')) {
        const info1 = parseTag(next1);
        if (info1.isClosing && info1.name === info.name) {
          lines.push(indentUnit.repeat(depth) + raw + next1);
          i += 1;
          continue;
        }
      }
      if (next1 !== undefined && !next1.startsWith('<') && next2 !== undefined) {
        const info2 = parseTag(next2);
        if (info2.isClosing && info2.name === info.name) {
          lines.push(indentUnit.repeat(depth) + raw + next1 + next2);
          i += 2;
          continue;
        }
      }

      lines.push(indentUnit.repeat(depth) + raw);
      depth++;
    }

    return lines.join('\n');
  }

  function formatCSS(src, indentUnit) {
    let output = '';
    let depth = 0;
    let i = 0;

    const atLineStart = () => output === '' || output.endsWith('\n');
    const trimTrailingSpaces = () => { output = output.replace(/[ \t]+$/, ''); };

    while (i < src.length) {
      const ch = src[i];

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }

      if (ch === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        const comment = end === -1 ? src.slice(i) : src.slice(i, end + 2);
        if (atLineStart()) output += indentUnit.repeat(depth);
        output += comment + '\n';
        i += comment.length;
        continue;
      }

      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== ch) j++;
        if (atLineStart()) output += indentUnit.repeat(depth);
        output += src.slice(i, j + 1);
        i = j + 1;
        continue;
      }

      if (ch === '{') {
        trimTrailingSpaces();
        output += ' {\n';
        depth++;
        i++;
        continue;
      }

      if (ch === '}') {
        depth = Math.max(0, depth - 1);
        trimTrailingSpaces();
        if (!output.endsWith('\n')) output += '\n';
        output += indentUnit.repeat(depth) + '}\n';
        i++;
        continue;
      }

      if (ch === ';') {
        trimTrailingSpaces();
        output += ';\n';
        i++;
        continue;
      }

      if (atLineStart()) output += indentUnit.repeat(depth);
      output += ch;
      i++;
    }

    return output.trim() + '\n';
  }

  /** Strips string/template literals and line comments so bracket-counting
      isn't thrown off by braces that appear inside them. */
  function stripStringsAndComments(line) {
    let result = '';
    let inStr = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inStr) {
        if (ch === '\\') { i++; continue; }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
      if (ch === '/' && line[i + 1] === '/') break;
      result += ch;
    }
    return result;
  }

  function formatJS(src, indentUnit) {
    const lines = src.split('\n');
    let depth = 0;
    const out = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === '') { out.push(''); continue; }

      const leadingClosers = (line.match(/^[)\]}]+/) || [''])[0];
      const closerCount = (leadingClosers.match(/[)\]}]/g) || []).length;
      const lineDepth = Math.max(0, depth - closerCount);

      out.push(indentUnit.repeat(lineDepth) + line);

      const stripped = stripStringsAndComments(line);
      const opens = (stripped.match(/[{([]/g) || []).length;
      const closes = (stripped.match(/[})\]]/g) || []).length;
      depth = Math.max(0, depth + opens - closes);
    }

    return out.join('\n');
  }

  function formatCode() {
    const indentUnit = ' '.repeat(state.tabSize);
    const before = codeInput.value;
    let formatted;
    if (state.activeFile === 'html') formatted = formatHTML(before, indentUnit);
    else if (state.activeFile === 'css') formatted = formatCSS(before, indentUnit);
    else formatted = formatJS(before, indentUnit);

    if (formatted === before) { showToast('Already formatted ✓'); return; }

    codeInput.value = formatted;
    onEditorInput();
    showToast(`Formatted ${FILE_META[state.activeFile].label} ✓`);
  }

  /* --------------------------- 7. FILE TABS / EXPLORER --------------------------- */

  function setActiveFile(fileKey) {
    state.activeFile = fileKey;

    $$('.tree-file').forEach(btn => {
      const active = btn.dataset.file === fileKey;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    $$('.tab').forEach(btn => {
      const active = btn.dataset.file === fileKey;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    statusCurrentFile.textContent = FILE_META[fileKey].label;
    loadFileIntoEditor();
  }

  function bindFileSwitching() {
    [fileTree, tabsBar].forEach(container => {
      container.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-file]');
        if (!btn) return;
        setActiveFile(btn.dataset.file);
        saveToStorage();
        closeMobileDrawer();
      });
    });
  }

  /* --------------------------- 8. LIVE PREVIEW --------------------------- */

  function compileHTML() {
    // Built via DOMParser + real DOM nodes rather than regex string-splicing.
    // Regex-splicing is fragile: if the user's HTML has a malformed/unclosed
    // tag (e.g. "<div" with no closing ">") anywhere BEFORE the <link>/<script>
    // tag, the browser's parser can swallow the very "<script>" bracket we
    // inject as part of that broken tag's attributes — so the real <script>
    // element never forms and the JS source leaks out as visible page text.
    // Appending actual DOM nodes sidesteps that: they're wired into the tree
    // as real elements no matter how broken the surrounding markup is.
    const doc = new DOMParser().parseFromString(files.html, 'text/html');

    // Console shim: overrides console.log/info/warn/error inside the preview
    // iframe so each call is also postMessage'd up to the parent page, which
    // renders it in the visible "Console" strip below the preview. Inserted
    // as the FIRST child of <head> so it wires up before any other script
    // (including the user's script.js, appended later at the end of <body>)
    // has a chance to call console.* itself.
    const consoleShim = doc.createElement('script');
    consoleShim.textContent = `(function(){
  function serialize(a){
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }
  ['log','info','warn','error'].forEach(function(level){
    var original = console[level];
    console[level] = function(){
      var text = Array.prototype.map.call(arguments, serialize).join(' ');
      try { window.parent.postMessage({ source: 'MyCodeNest-console', level: level, text: text }, '*'); } catch (e) {}
      original.apply(console, arguments);
    };
  });
  window.addEventListener('error', function(e){
    try { window.parent.postMessage({ source: 'MyCodeNest-console', level: 'error', text: e.message || 'Script error' }, '*'); } catch (err) {}
  });
})();`;
    (doc.head || doc.documentElement).insertBefore(consoleShim, (doc.head || doc.documentElement).firstChild);

    // Only remove the app's own style.css link — leaves any external
    // stylesheet (Google Fonts, a CDN link, etc.) the user adds untouched.
    doc.querySelectorAll('link[rel="stylesheet"][href="style.css"]').forEach(el => el.remove());
    const styleEl = doc.createElement('style');
    styleEl.textContent = files.css;
    (doc.head || doc.documentElement).appendChild(styleEl);

    doc.querySelectorAll('script[src="script.js"]').forEach(el => el.remove());
    const scriptEl = doc.createElement('script');
    scriptEl.textContent = files.js;
    (doc.body || doc.documentElement).appendChild(scriptEl);

    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  }

  const CONSOLE_EMPTY_TEXT = 'Console output will appear here — try console.log() in script.js';

  function clearConsole(bodyEl) {
    bodyEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'preview-console__empty';
    empty.textContent = CONSOLE_EMPTY_TEXT;
    bodyEl.appendChild(empty);
  }

  function appendConsoleLine(bodyEl, level, text) {
    const emptyEl = bodyEl.querySelector('.preview-console__empty');
    if (emptyEl) emptyEl.remove();
    const line = document.createElement('div');
    line.className = 'preview-console__line' + (level === 'log' ? '' : ` preview-console__line--${level}`);
    line.textContent = text;
    bodyEl.appendChild(line);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function bindConsoleMessages() {
    window.addEventListener('message', (e) => {
      if (!e.data || e.data.source !== 'MyCodeNest-console') return;
      if (previewFrame.contentWindow && e.source === previewFrame.contentWindow) {
        appendConsoleLine(previewConsoleBody, e.data.level, e.data.text);
      } else if (mobilePreviewFrame.contentWindow && e.source === mobilePreviewFrame.contentWindow) {
        appendConsoleLine(mobilePreviewConsoleBody, e.data.level, e.data.text);
      }
    });
    previewConsoleClearBtn.addEventListener('click', () => clearConsole(previewConsoleBody));
    mobilePreviewConsoleClearBtn.addEventListener('click', () => clearConsole(mobilePreviewConsoleBody));
  }

  function renderPreview() {
    const doc = compileHTML();
    if (state.previewOpen) { clearConsole(previewConsoleBody); previewFrame.srcdoc = doc; }
    if (mobilePreviewModal.classList.contains('open')) { clearConsole(mobilePreviewConsoleBody); mobilePreviewFrame.srcdoc = doc; }
  }

  /* --------------------------- 9. TOOLBAR ACTIONS --------------------------- */

  function openPreview() {
    if (window.innerWidth <= 900) {
      mobilePreviewModal.classList.add('open');
      renderPreview();
      return;
    }
    state.previewOpen = true;
    workspace.classList.add('preview-open');
    previewToggleBtn.setAttribute('aria-pressed', 'true');
    document.documentElement.style.setProperty('--preview-width', state.previewWidth + 'px');
    renderPreview();
    saveToStorage();
  }

  function closePreview() {
    state.previewOpen = false;
    workspace.classList.remove('preview-open');
    previewToggleBtn.setAttribute('aria-pressed', 'false');
    saveToStorage();
  }

  function togglePreview() {
    if (window.innerWidth <= 900) {
      mobilePreviewModal.classList.toggle('open');
      if (mobilePreviewModal.classList.contains('open')) renderPreview();
      return;
    }
    state.previewOpen ? closePreview() : openPreview();
  }

  async function copyCurrentFile() {
    try {
      await navigator.clipboard.writeText(codeInput.value);
      showToast(`Copied ${FILE_META[state.activeFile].label} ✓`);
    } catch (e) {
      codeInput.select();
      document.execCommand('copy');
      showToast(`Copied ${FILE_META[state.activeFile].label} ✓`);
    }
  }

  async function downloadProject() {
    if (typeof JSZip === 'undefined') {
      showToast('Download unavailable — network blocked JSZip', true);
      return;
    }
    const zip = new JSZip();
    zip.file('index.html', files.html);
    zip.file('style.css', files.css);
    zip.file('script.js', files.js);
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (state.projectName || 'MyCodeNest-project').trim().replace(/[^a-z0-9-_ ]/gi, '') || 'MyCodeNest-project';
    a.href = url;
    a.download = `${safeName}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Project downloaded ✓');
  }

  function bindProjectName() {
    projectNameInput.addEventListener('input', () => {
      state.projectName = projectNameInput.value;
      explorerProjectLabel.textContent = state.projectName || 'My Project';
      scheduleSave();
    });
    projectNameInput.addEventListener('blur', () => {
      if (!projectNameInput.value.trim()) {
        projectNameInput.value = 'My Project';
        state.projectName = 'My Project';
        explorerProjectLabel.textContent = 'My Project';
      }
      saveToStorage();
    });
  }

  /* --------------------------- 10. SETTINGS PANEL --------------------------- */

  function openSettings() {
    fontSizeRange.value = state.fontSize;
    fontSizeValue.textContent = state.fontSize + 'px';
    tabSizeRange.value = state.tabSize;
    tabSizeValue.textContent = state.tabSize + ' spaces';
    wordWrapToggle.checked = state.wordWrap;
    themeSelect.value = state.theme;
    previewWidthRange.value = state.previewWidth;
    previewWidthValue.textContent = state.previewWidth + 'px';
    settingsBackdrop.classList.add('open');
  }

  function closeSettings() {
    settingsBackdrop.classList.remove('open');
    saveToStorage();
  }

  function bindSettings() {
    settingsBtn.addEventListener('click', openSettings);
    settingsCloseBtn.addEventListener('click', closeSettings);
    settingsDoneBtn.addEventListener('click', closeSettings);
    settingsBackdrop.addEventListener('click', (e) => { if (e.target === settingsBackdrop) closeSettings(); });

    fontSizeRange.addEventListener('input', () => {
      state.fontSize = Number(fontSizeRange.value);
      fontSizeValue.textContent = state.fontSize + 'px';
      applyEditorSettings();
      scheduleSave();
    });

    tabSizeRange.addEventListener('input', () => {
      state.tabSize = Number(tabSizeRange.value);
      tabSizeValue.textContent = state.tabSize + ' spaces';
      applyEditorSettings();
      scheduleSave();
    });

    wordWrapToggle.addEventListener('change', () => {
      state.wordWrap = wordWrapToggle.checked;
      applyEditorSettings();
      scheduleSave();
    });

    themeSelect.addEventListener('change', () => {
      setTheme(themeSelect.value);
      scheduleSave();
    });

    previewWidthRange.addEventListener('input', () => {
      state.previewWidth = Number(previewWidthRange.value);
      previewWidthValue.textContent = state.previewWidth + 'px';
      document.documentElement.style.setProperty('--preview-width', state.previewWidth + 'px');
      scheduleSave();
    });

    resetSettingsBtn.addEventListener('click', () => {
      state.fontSize = 14;
      state.tabSize = 4;
      state.wordWrap = true;
      state.previewWidth = 480;
      openSettings();
      applyEditorSettings();
      document.documentElement.style.setProperty('--preview-width', state.previewWidth + 'px');
      scheduleSave();
      showToast('Settings reset ✓');
    });
  }

  /* --------------------------- 11. THEME --------------------------- */

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function effectiveTheme() {
    return state.theme === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : state.theme;
  }

  function setTheme(theme) {
    state.theme = theme;
    const applied = effectiveTheme();
    body.setAttribute('data-theme', applied);
    statusTheme.textContent = (applied === 'dark' ? 'Dark' : 'Light') + ' theme' + (theme === 'auto' ? ' (auto)' : '');
  }

  function bindThemeToggle() {
    themeToggle.addEventListener('click', () => {
      const applied = effectiveTheme();
      setTheme(applied === 'dark' ? 'light' : 'dark');
      saveToStorage();
    });

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (state.theme === 'auto') setTheme('auto');
      });
    }
  }

  /* --------------------------- 13. RESIZABLE DIVIDER --------------------------- */

  function bindResizer() {
    let dragging = false;

    const onMove = (clientX) => {
      const rect = workspace.getBoundingClientRect();
      let newWidth = rect.right - clientX;
      newWidth = Math.max(280, Math.min(900, newWidth));
      state.previewWidth = newWidth;
      document.documentElement.style.setProperty('--preview-width', newWidth + 'px');
    };

    resizer.addEventListener('mousedown', (e) => {
      dragging = true;
      workspace.classList.add('resizing');
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => { if (dragging) onMove(e.clientX); });
    window.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        workspace.classList.remove('resizing');
        document.body.style.userSelect = '';
        saveToStorage();
      }
    });

    resizer.addEventListener('touchstart', () => { dragging = true; workspace.classList.add('resizing'); }, { passive: true });
    window.addEventListener('touchmove', (e) => { if (dragging && e.touches[0]) onMove(e.touches[0].clientX); }, { passive: true });
    window.addEventListener('touchend', () => {
      if (dragging) {
        dragging = false;
        workspace.classList.remove('resizing');
        saveToStorage();
      }
    });

    resizer.addEventListener('keydown', (e) => {
      const step = 20;
      if (e.key === 'ArrowLeft') { state.previewWidth = Math.min(900, state.previewWidth + step); document.documentElement.style.setProperty('--preview-width', state.previewWidth + 'px'); saveToStorage(); }
      if (e.key === 'ArrowRight') { state.previewWidth = Math.max(280, state.previewWidth - step); document.documentElement.style.setProperty('--preview-width', state.previewWidth + 'px'); saveToStorage(); }
    });
  }

  /* --------------------------- 14. MOBILE DRAWER & PREVIEW MODAL --------------------------- */

  function openMobileDrawer() {
    explorer.classList.add('mobile-open');
    drawerBackdrop.style.display = 'block';
    drawerToggle.setAttribute('aria-expanded', 'true');
  }
  function closeMobileDrawer() {
    explorer.classList.remove('mobile-open');
    drawerBackdrop.style.display = 'none';
    drawerToggle.setAttribute('aria-expanded', 'false');
  }

  function bindMobileNav() {
    drawerToggle.addEventListener('click', () => {
      explorer.classList.contains('mobile-open') ? closeMobileDrawer() : openMobileDrawer();
    });
    explorerCloseBtn.addEventListener('click', closeMobileDrawer);
    drawerBackdrop.addEventListener('click', closeMobileDrawer);

    mobilePreviewCloseBtn.addEventListener('click', () => mobilePreviewModal.classList.remove('open'));
  }

  /* --------------------------- 15. KEYBOARD SHORTCUTS --------------------------- */

  function bindGlobalShortcuts() {
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); renderPreview(); showToast('Preview refreshed ✓'); }
      if (mod && e.shiftKey && (e.key === 'C' || e.key === 'c')) { e.preventDefault(); copyCurrentFile(); }
      if (mod && e.key === 's') { e.preventDefault(); saveToStorage(); showToast('Saved ✓'); }
      if ((mod && e.altKey && (e.key === 'f' || e.key === 'F')) || (e.shiftKey && e.altKey && (e.key === 'f' || e.key === 'F'))) {
        e.preventDefault();
        formatCode();
      }
      if (e.key === 'Escape') {
        if (settingsBackdrop.classList.contains('open')) closeSettings();
        if (mobilePreviewModal.classList.contains('open')) mobilePreviewModal.classList.remove('open');
        if (explorer.classList.contains('mobile-open')) closeMobileDrawer();
      }
    });
  }

  /* --------------------------- 16. TOAST --------------------------- */

  let toastTimer = null;
  function showToast(message, isError) {
    toast.textContent = message;
    toast.style.borderColor = isError ? 'var(--danger)' : 'var(--border)';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  /* --------------------------- 17. INIT --------------------------- */

  function bindEditorEvents() {
    codeInput.addEventListener('input', onEditorInput);
    codeInput.addEventListener('keydown', handleEditorKeydown);
    codeInput.addEventListener('click', () => { updateActiveLine(); updateStatusCursor(); });
    codeInput.addEventListener('keyup', () => { updateActiveLine(); updateStatusCursor(); });
    codeInput.addEventListener('scroll', syncScroll);
  }

  function bindToolbar() {
    runBtn.addEventListener('click', () => {
      renderPreview();
      if (!state.previewOpen && window.innerWidth > 900) openPreview();
      if (window.innerWidth <= 900) { mobilePreviewModal.classList.add('open'); renderPreview(); }
      showToast('Project ran ✓');
    });

    formatBtn.addEventListener('click', formatCode);
    previewToggleBtn.addEventListener('click', togglePreview);
    previewCloseBtn.addEventListener('click', closePreview);
    refreshPreviewBtn.addEventListener('click', () => { renderPreview(); showToast('Preview refreshed ✓'); });

    copyBtn.addEventListener('click', copyCurrentFile);
    downloadBtn.addEventListener('click', downloadProject);
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset the project? This will discard your current HTML, CSS and JavaScript.')) {
        resetProject();
      }
    });
  }

  function restoreUI() {
    projectNameInput.value = state.projectName;
    explorerProjectLabel.textContent = state.projectName || 'My Project';
    setTheme(state.theme);
    setActiveFile(state.activeFile);
    applyEditorSettings();
    document.documentElement.style.setProperty('--preview-width', state.previewWidth + 'px');
    if (state.previewOpen && window.innerWidth > 900) {
      workspace.classList.add('preview-open');
      previewToggleBtn.setAttribute('aria-pressed', 'true');
    }
    renderPreview();
  }

  function init() {
    const hadSavedData = loadFromStorage();
    if (!hadSavedData || !files.html) {
      files = defaultFiles();
    }

    bindEditorEvents();
    bindFileSwitching();
    bindToolbar();
    bindSettings();
    bindThemeToggle();
    bindResizer();
    bindMobileNav();
    bindGlobalShortcuts();
    bindProjectName();
    bindConsoleMessages();

    clearConsole(previewConsoleBody);
    clearConsole(mobilePreviewConsoleBody);

    restoreUI();
    flashSaved();

    window.addEventListener('resize', () => {
      if (window.innerWidth <= 900) {
        workspace.classList.remove('preview-open');
      } else if (state.previewOpen) {
        workspace.classList.add('preview-open');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();