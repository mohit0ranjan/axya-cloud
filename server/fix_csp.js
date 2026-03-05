const fs = require('fs');

const indexTsPath = 'src/index.ts';
let indexCode = fs.readFileSync(indexTsPath, 'utf8');

if (!indexCode.includes("import crypto from 'crypto';")) {
    indexCode = indexCode.replace("import os from 'os';", "import os from 'os';\nimport crypto from 'crypto';");
}

if (indexCode.includes("app.use(helmet());")) {
    indexCode = indexCode.replace("app.use(helmet());", `app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('base64');
    next();
});

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", (req, res) => "'nonce-" + res.locals.nonce + "'"],
        },
    },
}));`);
}

fs.writeFileSync(indexTsPath, indexCode);
console.log('Updated index.ts');

const shareTsPath = 'src/controllers/share.controller.ts';
let shareCode = fs.readFileSync(shareTsPath, 'utf8');

const htmlReplacement = `<input type="password" id="pw" placeholder="Enter password" />
                <button id="submitBtn">Access Link</button>
              </div>
              <script nonce="\${res.locals.nonce}">
                async function submitPw() {
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
                });
              </script>`;

// Replace the chunk starting from <input type="password"... to </script>
shareCode = shareCode.replace(/<input type="password" id="pw" placeholder="Enter password" \/>.*?<\/script>/s, htmlReplacement);

fs.writeFileSync(shareTsPath, shareCode);
console.log('Updated share.controller.ts');
