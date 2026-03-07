const fs = require('fs');
const path = 'src/controllers/share.controller.ts';

let code = fs.readFileSync(path, 'utf8');

// Replace the hardcoded javascript onclick snippet inside the second HTML block
const secondHtmlSnippet = `<button onclick="submitPw()">Access Link</button>`;
const secondHtmlReplacement = `<button id="submitBtn">Access Link</button>`;

code = code.replace(secondHtmlSnippet, secondHtmlReplacement);

const scriptStart = `<script>`;
const scriptReplacement = `<script nonce="\${res.locals.nonce}">`;

if (!code.includes(scriptReplacement)) {
    code = code.replace(scriptStart, scriptReplacement);
}

// Ensure the second html block is updated with Event listeners
if (code.includes(`async function submitPw() {
                  const pw = document.getElementById('pw').value;
                  const res = await fetch(\`/share/\${token}/password\`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    credentials: 'same-origin',
                    body: JSON.stringify({password: pw})
                  });
                  if (res.ok) window.location.reload();
                  else document.getElementById('err').style.display = 'block';
                }`)) {

    const submitPwFunction = `async function submitPw() {
                  const pw = document.getElementById('pw').value;
                  const res = await fetch(\`/share/\${token}/password\`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    credentials: 'same-origin',
                    body: JSON.stringify({password: pw})
                  });
                  if (res.ok) window.location.reload();
                  else document.getElementById('err').style.display = 'block';
                }
                document.getElementById('submitBtn').addEventListener('click', submitPw);
                document.getElementById('pw').addEventListener('keypress', function (e) {
                  if (e.key === 'Enter') submitPw();
                });`;

    code = code.replace(`async function submitPw() {
                  const pw = document.getElementById('pw').value;
                  const res = await fetch(\`/share/\${token}/password\`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    credentials: 'same-origin',
                    body: JSON.stringify({password: pw})
                  });
                  if (res.ok) window.location.reload();
                  else document.getElementById('err').style.display = 'block';
                }`, submitPwFunction);
}

fs.writeFileSync(path, code);
console.log('Fixed second HTML block script and onclick handlers.');
