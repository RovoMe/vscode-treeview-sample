// @ts-nocheck

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('filterForm').addEventListener('submit', () => {
        const term = document.getElementById('term').value;
        const hasFiles = document.getElementById('hasFiles').checked;
        filter(term, hasFiles);
    });
});

// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
let vscode;
function filter(term, hasFiles) {
    if (!vscode) {
        vscode = acquireVsCodeApi();
    }
    vscode.postMessage({
        command: 'filter',
        term,
        hasFiles
    });
}