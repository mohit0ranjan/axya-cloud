import fs from 'fs';
let c = fs.readFileSync('server/src/controllers/upload/upload.handlers.ts', 'utf8');

c = c.replace(/return res\.status\(401\)\.json\(\{\s*success:\s*false,\s*error:\s*'Unauthorized'\s*\}\);/g,
 "return sendApiError(res, 401, 'unauthorized', 'Unauthorized');");

c = c.replace(/return res\.status\(400\)\.json\(\{\s*success:\s*false,\s*error:\s*'Missing file info \\(originalname, size required\\)'\s*\}\);/g,
 "return sendApiError(res, 400, 'missing_file_info', 'Missing file info (originalname, size required)');");

c = c.replace(/return res\.status\(400\)\.json\(\{\s*success:\s*false,\s*error:\s*'File size must be greater than 0 bytes'\s*\}\);/g,
 "return sendApiError(res, 400, 'invalid_file_size', 'File size must be greater than 0 bytes');");

c = c.replace(/return res\.status\(500\)\.json\(\{\s*success:\s*false,\s*error:\s*'Could not initialize upload session'\s*\}\);/g,
 "return sendApiError(res, 500, 'internal_error', 'Could not initialize upload session');");

c = c.replace(/return res\.status\(400\)\.json\(\{\s*success:\s*false,\s*error:\s*'Missing uploadId'\s*\}\);/g,
 "return sendApiError(res, 400, 'missing_upload_id', 'Missing uploadId');");

c = c.replace(/return res\.status\(404\)\.json\(\{\s*success:\s*false,\s*error:\s*'Upload session not found'\s*\}\);/g,
 "return sendApiError(res, 404, 'upload_not_found', 'Upload session not found');");

c = c.replace(/return res\.status\(409\)\.json\(\{\s*success:\s*false,\s*error:\s*'Upload has been cancelled',\s*code:\s*'UPLOAD_CANCELLED'\s*\}\);/g,
 "return sendApiError(res, 409, 'UPLOAD_CANCELLED', 'Upload has been cancelled');");

c = c.replace(/return res\.status\(409\)\.json\(\{\s*success:\s*false,\s*error:\s*'Upload is in failed state\. Restart required\.',\s*code:\s*'UPLOAD_FAILED'\s*\}\);/g,
 "return sendApiError(res, 409, 'UPLOAD_FAILED', 'Upload is in failed state. Restart required.', { retryable: false });");

c = c.replace(/return res\.status\(400\)\.json\(\{\s*success:\s*false,\s*error:\s*'Chunk file could not be read'\s*\}\);/g,
 "return sendApiError(res, 400, 'chunk_read_error', 'Chunk file could not be read');");

c = c.replace(/return res\.status\(500\)\.json\(\{\s*success:\s*false,\s*error:\s*'Failed to persist chunk'\s*\}\);/g,
 "return sendApiError(res, 500, 'internal_error', 'Failed to persist chunk');");

c = c.replace(/return res\.status\(409\)\.json\(\{\s*success:\s*false,\s*error:\s*'Upload is cancelled',\s*code:\s*'UPLOAD_CANCELLED'\s*\}\);/g,
 "return sendApiError(res, 409, 'UPLOAD_CANCELLED', 'Upload is cancelled');");

c = c.replace(/return res\.status\(404\)\.json\(\{\s*success:\s*false,\s*error:\s*'Upload not found or expired'\s*\}\);/g,
 "return sendApiError(res, 404, 'upload_not_found', 'Upload not found or expired');");

c = c.replace(/return res\.status\(409\)\.json\(\{\s*success:\s*false,\s*error:\s*'Chunk race detected; please retry',\s*code:\s*'CHUNK_RACE'\s*\}\);/g,
 "return sendApiError(res, 409, 'CHUNK_RACE', 'Chunk race detected; please retry', { retryable: true });");

c = c.replace(/return res\.status\(409\)\.json\(\{\s*success:\s*false,\s*error:\s*'Conflicting chunk race',\s*code:\s*'CHUNK_CONFLICT'\s*\}\);/g,
 "return sendApiError(res, 409, 'CHUNK_CONFLICT', 'Conflicting chunk race');");

fs.writeFileSync('server/src/controllers/upload/upload.handlers.ts', c);
console.log('done');
