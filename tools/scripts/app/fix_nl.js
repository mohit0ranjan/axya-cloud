const fs = require('fs');
let file = fs.readFileSync('d:/Projects/teledrive/app/src/screens/HomeScreen.tsx', 'utf8');

// Replace literal '\n' string with actual newline.
file = file.replace(/\\nexport default function/g, '\nexport default function');

fs.writeFileSync('d:/Projects/teledrive/app/src/screens/HomeScreen.tsx', file);
console.log('Fixed literal newline.');
