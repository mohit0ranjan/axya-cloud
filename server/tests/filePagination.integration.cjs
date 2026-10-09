// Requires the explicitly configured testing database and the local API.
// Creates a disposable owner and removes every row it inserts.
require('dotenv').config({quiet:true});
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const pool = require('../dist/config/db').default;
const { encryptSession } = require('../dist/utils/sessionEncryption');
const owner = crypto.randomUUID();
const folder = crypto.randomUUID();
const base = process.env.TEST_API_URL || 'http://localhost:3000';
const authorization = `Bearer ${jwt.sign({userId:owner},process.env.JWT_SECRET,{expiresIn:'10m'})}`;

async function list(query) {
  const response = await fetch(`${base}/files?${query}`, {headers:{authorization},signal:AbortSignal.timeout(30000)});
  const body = await response.json();
  assert.equal(response.status,200,body.error || query);
  return body;
}

(async()=>{
  try {
    await pool.query('INSERT INTO users (id, phone, session_string, name) VALUES ($1,$2,$3,$4)', [owner,`test:${owner}`,encryptSession('pagination-test-no-telegram-access'),'Pagination test']);
    await pool.query('INSERT INTO folders (id,user_id,name) VALUES ($1,$2,$3)',[folder,owner,'Pagination test folder']);
    await pool.query(`INSERT INTO files (id,user_id,folder_id,file_name,file_size,telegram_file_id,telegram_message_id,mime_type)
      SELECT gen_random_uuid(),$1,$2,CASE WHEN n=601 THEN 'Paged needle 601.pdf' ELSE 'Paged item '||LPAD(n::text,3,'0')||'.txt' END,
      n,'pagination-test',n,CASE WHEN n=601 THEN 'application/pdf' ELSE 'text/plain' END
      FROM generate_series(1,601) AS n`,[owner,folder]);
    let rows=[];
    for(let offset=0;offset<601;offset+=80){
      const page=await list(`folder_id=${folder}&sort=file_name&order=ASC&limit=80&offset=${offset}`);
      assert.equal(page.total_count,601);
      assert.ok(page.files.length<=80);
      rows.push(...page.files);
    }
    assert.equal(rows.length,601);
    assert.equal(new Set(rows.map(file=>file.id)).size,601);
    const found=await list(`folder_id=${folder}&q=needle&limit=80`);
    assert.equal(found.total_count,1);
    assert.equal(found.files[0].name,'Paged needle 601.pdf');
    const docs=await list(`folder_id=${folder}&type=docs&limit=80`);
    assert.equal(docs.total_count,601);
    const images=await list(`folder_id=${folder}&type=image&limit=80`);
    assert.equal(images.total_count,0);
    console.log('PASS: all 601 files accessible across server pages; remote search and type filters cover the full folder.');
  } finally {
    await pool.query('DELETE FROM files WHERE user_id=$1',[owner]);
    await pool.query('DELETE FROM folders WHERE user_id=$1',[owner]);
    await pool.query('DELETE FROM users WHERE id=$1',[owner]);
    await pool.end();
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
