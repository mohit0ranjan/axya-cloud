const fs = require('fs');

let input = fs.readFileSync('server/src/controllers/upload/upload.handlers.ts', 'utf8');

input = input.replace(/res\.status\((.*?)\)\.json\(\{(.*?)(success:\s*false)(.*?)\}\)(;?)/gs, (match, p1, p2, p3, p4, p5) => {
    if (match.includes('message:')) return match;
    
    const errMatch = match.match(/error:\s*([^,]+)(?=,|}|\n)/);
    
    if (errMatch) {
       let injection = \, message: \\;
       if (!match.includes('code:')) {
          let code = "'upload_error'";
          if (p1.trim() === '401') code = "'unauthorized'";
          if (p1.trim() === '404') code = "'not_found'";
          if (p1.trim() === '400') code = "'invalid_request'";
          if (p1.trim() === '422') code = "'validation_error'";
          injection += \, code: \\;
       }
       return \es.status(\).json({\\\\ })\\;
    }
    return match;
});

fs.writeFileSync('server/src/controllers/upload/upload.handlers.ts', input);
