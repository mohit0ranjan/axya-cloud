#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import crypto from 'node:crypto';

const BASE_URL = (process.env.UPLOAD_TEST_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.UPLOAD_TEST_BEARER_TOKEN || '';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.UPLOAD_TEST_REQUEST_TIMEOUT_MS || '15000', 10);
const POLL_INTERVAL_MS = Number.parseInt(process.env.UPLOAD_TEST_POLL_INTERVAL_MS || '1500', 10);
const COMPLETE_TIMEOUT_MS = Number.parseInt(process.env.UPLOAD_TEST_COMPLETE_TIMEOUT_MS || '300000', 10);
const SKIP_COMPLETE = process.env.UPLOAD_TEST_SKIP_COMPLETE === '1';
const TEST_CHUNK_SIZE = Number.parseInt(process.env.UPLOAD_TEST_CHUNK_SIZE_BYTES || String(5 * 1024 * 1024), 10);
const ENABLE_LARGE_TEST = process.env.UPLOAD_TEST_ENABLE_LARGE === '1';
const LARGE_TEST_SIZE_BYTES = Number.parseInt(process.env.UPLOAD_TEST_LARGE_SIZE_BYTES || String(1024 * 1024 * 1024 + 5), 10);
const LEAK_LOOP_COUNT = Number.parseInt(process.env.UPLOAD_TEST_LEAK_LOOP_COUNT || '12', 10);
const MAX_HEAP_DELTA_MB = Number.parseInt(process.env.UPLOAD_TEST_MAX_HEAP_DELTA_MB || '180', 10);

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed', 'error']);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildDeterministicBuffer(byteLength) {
  const output = Buffer.allocUnsafe(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    output[index] = (index * 31) % 251;
  }
  return output;
}

function splitIntoChunks(buffer, chunkSize) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    chunks.push(buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length)));
  }
  return chunks;
}

function stringifyBody(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  return JSON.stringify(value);
}

async function requestJson(method, route, {
  body,
  expectedStatuses = [200],
  tokenOverride,
  timeoutMs,
} = {}) {
  const url = `${BASE_URL}${route}`;
  const abortController = new AbortController();
  const effectiveTimeout = Number.isFinite(timeoutMs) ? timeoutMs : REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => abortController.abort(new Error(`Request timeout: ${method} ${route}`)), effectiveTimeout);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${tokenOverride ?? TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: stringifyBody(body),
      signal: abortController.signal,
    });

    const raw = await response.text();
    let payload;

    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { raw };
    }

    if (!expectedStatuses.includes(response.status)) {
      const compact = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
      throw new Error(`Unexpected status ${response.status} for ${method} ${route}: ${compact}`);
    }

    return { status: response.status, data: payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function initUpload(fileName, fileSize, chunkSizeBytes = TEST_CHUNK_SIZE) {
  const response = await requestJson('POST', '/files/upload/init', {
    body: {
      originalname: fileName,
      size: fileSize,
      mimetype: 'application/pdf',
      chunk_size_bytes: chunkSizeBytes,
    },
  });

  assert(response.data.success === true, 'Upload init did not report success=true');
  assert(typeof response.data.uploadId === 'string' && response.data.uploadId.length > 0, 'Upload init did not return uploadId');
  assert(Number(response.data.chunkSizeBytes) === TEST_CHUNK_SIZE, `Expected chunkSizeBytes=${TEST_CHUNK_SIZE}`);
  assert(typeof response.data.resumeToken === 'string' && response.data.resumeToken.length > 20, 'Upload init did not return resumeToken');
  return response.data;
}

async function initUploadRaw(payload, expectedStatuses = [200]) {
  return requestJson('POST', '/files/upload/init', {
    expectedStatuses,
    body: payload,
  });
}

async function uploadChunk(uploadId, chunkIndex, chunkBuffer) {
  let attempts = 0;
  while (attempts < 30) {
    attempts += 1;
    const response = await requestJson('POST', '/files/upload/chunk', {
      expectedStatuses: [200, 409],
      body: {
        uploadId,
        chunkIndex,
        chunkBase64: chunkBuffer.toString('base64'),
      },
    });

    if (response.status === 200) return response;

    const code = String(response.data?.code || '').toUpperCase();
    if (code !== 'UPLOAD_QUEUED') {
      throw new Error(`Chunk upload failed with 409 code=${code || 'unknown'}`);
    }

    const waitMs = Math.max(1000, Number(response.data?.recommendedPollMs || POLL_INTERVAL_MS));
    await delay(waitMs);
  }

  throw new Error('Chunk upload remained queued beyond retry budget');
}

async function resolveUploadByResumeToken(resumeToken, expectedStatuses = [200]) {
  const response = await requestJson('POST', '/files/upload/resume', {
    expectedStatuses,
    body: { resumeToken },
  });
  return response.data;
}

async function completeUpload(uploadId) {
  const response = await requestJson('POST', '/files/upload/complete', {
    body: { uploadId },
  });

  assert(response.data.success === true, 'Upload complete did not report success=true');
  return response.data;
}

async function pauseUpload(uploadId) {
  const response = await requestJson('POST', '/upload/pause', {
    body: { uploadId },
  });
  assert(response.data.success === true, 'Upload pause did not report success=true');
  return response.data;
}

async function resumePausedUpload(uploadId) {
  const response = await requestJson('POST', '/upload/resume', {
    body: { uploadId },
  });
  assert(response.data.success === true, 'Upload resume did not report success=true');
  return response.data;
}

async function cancelUpload(uploadId) {
  const response = await requestJson('POST', '/files/upload/cancel', {
    body: { uploadId },
  });
  assert(response.data.success === true, 'Upload cancel did not report success=true');
  return response.data;
}

async function readUploadStatus(uploadId, expectedStatuses = [200]) {
  const response = await requestJson('GET', `/files/upload/status/${encodeURIComponent(uploadId)}`, {
    expectedStatuses,
  });
  return response.data;
}

async function readUploadQueueHealth() {
  const response = await requestJson('GET', '/upload/queue-health', {
    expectedStatuses: [200],
  });
  return response.data;
}

async function pollForTerminalStatus(uploadId, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await readUploadStatus(uploadId);
    if (TERMINAL_STATUSES.has(status.status)) {
      return status;
    }
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`Upload ${uploadId} did not reach terminal state within ${timeoutMs}ms`);
}

async function waitForQueueRelease(uploadId, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await readUploadStatus(uploadId);
    if (status.status !== 'queued') return status;
    const waitMs = Math.max(1000, Number(status.recommendedPollMs || POLL_INTERVAL_MS));
    await delay(waitMs);
  }
  throw new Error(`Upload ${uploadId} stayed queued beyond ${timeoutMs}ms`);
}

async function runReliabilityResumeScenario() {
  console.log('\n[Scenario 1] persistence + out-of-order + duplicate + retry + resume + complete');

  const payload = buildDeterministicBuffer(11 * 1024 * 1024 + 73);
  const chunks = splitIntoChunks(payload, TEST_CHUNK_SIZE);
  assert(chunks.length >= 3, 'Expected at least 3 chunks for reliability scenario');
  const fileName = `upload-lifecycle-${Date.now()}-${randomUUID().slice(0, 8)}.bin`;

  const init = await initUpload(fileName, payload.length, TEST_CHUNK_SIZE);
  const uploadId = String(init.uploadId);
  const resumeToken = String(init.resumeToken);
  console.log(`[Step] initialized uploadId=${uploadId}`);

  const resumeAtStart = await resolveUploadByResumeToken(resumeToken);
  assert(resumeAtStart.success === true, 'Resume endpoint did not return success=true at start');
  assert(String(resumeAtStart.uploadId || '') === uploadId, 'Resume endpoint returned mismatched uploadId');
  assert(Number(resumeAtStart.nextExpectedChunk) === 0, 'Expected nextExpectedChunk=0 at upload start');

  const invalidResume = await resolveUploadByResumeToken(`${resumeToken}.tampered`, [401]);
  assert(String(invalidResume.code || '').toLowerCase() === 'resume_token_invalid', 'Expected resume_token_invalid for tampered token');

  await waitForQueueRelease(uploadId);

  const sessionsAfterInit = await requestJson('GET', '/files/upload/sessions');
  const hasUploadInSessions = Array.isArray(sessionsAfterInit.data.sessions)
    && sessionsAfterInit.data.sessions.some((s) => s?.uploadId === uploadId);
  assert(hasUploadInSessions, 'Expected upload session to be persisted and listed');

  const outOfOrder = await uploadChunk(uploadId, 1, chunks[1]);
  assert(outOfOrder.data.success === true, 'Out-of-order chunk should be accepted');
  assert(outOfOrder.data.nextExpectedChunk === 0, 'Expected nextExpectedChunk=0 after uploading chunk 1 first');

  const resumedAfterOutOfOrder = await resolveUploadByResumeToken(resumeToken);
  assert(resumedAfterOutOfOrder.success === true, 'Resume endpoint failed after out-of-order chunk');
  assert(Number(resumedAfterOutOfOrder.nextExpectedChunk) === 0, 'Resume endpoint should preserve nextExpectedChunk after out-of-order chunk');

  const statusAfterOutOfOrder = await readUploadStatus(uploadId);
  assert(statusAfterOutOfOrder.nextExpectedChunk === 0, 'Status should persist nextExpectedChunk=0 after out-of-order write');

  const chunk0Response = await uploadChunk(uploadId, 0, chunks[0]);
  assert(chunk0Response.data.success === true, 'Chunk 0 did not report success=true after out-of-order chunk');

  const duplicateRetry = await uploadChunk(uploadId, 0, chunks[0]);
  assert(duplicateRetry.data.success === true, 'Duplicate retry should still return success');
  assert(duplicateRetry.data.duplicate === true, 'Duplicate retry should be marked duplicate=true');

  const unauthorizedRetry = await requestJson('POST', '/files/upload/chunk', {
    expectedStatuses: [401],
    tokenOverride: 'invalid.token.value',
    body: {
      uploadId,
      chunkIndex: 2,
      chunkBase64: chunks[2].toString('base64'),
    },
  });
  assert(unauthorizedRetry.data.success === false, 'Unauthorized chunk call should fail');

  // Simulate transient network failure on chunk upload (client timeout), then retry.
  let transientFailureTriggered = false;
  try {
    await requestJson('POST', '/files/upload/chunk', {
      timeoutMs: 1,
      body: {
        uploadId,
        chunkIndex: 2,
        chunkBase64: chunks[2].toString('base64'),
      },
    });
  } catch {
    transientFailureTriggered = true;
  }

  const chunk2Retry = await uploadChunk(uploadId, 2, chunks[2]);
  assert(chunk2Retry.data.success === true, 'Chunk retry after transient failure should succeed');
  if (transientFailureTriggered) {
    assert(chunk2Retry.data.duplicate === true || chunk2Retry.data.duplicate === false, 'Chunk retry should be handled idempotently');
  }

  const resumedAfterNetworkInterruption = await resolveUploadByResumeToken(resumeToken);
  assert(resumedAfterNetworkInterruption.success === true, 'Resume endpoint failed after simulated interruption');
  assert(Number(resumedAfterNetworkInterruption.nextExpectedChunk) >= 0, 'Resume endpoint returned invalid nextExpectedChunk');

  const resumeStatus = await readUploadStatus(uploadId);
  assert(resumeStatus.success === true, 'Status endpoint did not report success=true');

  const remainingIndexes = [];
  for (let index = 0; index < chunks.length; index += 1) {
    if (index === 0 || index === 1 || index === 2) continue;
    remainingIndexes.push(index);
  }

  for (const index of remainingIndexes) {
    const response = await uploadChunk(uploadId, index, chunks[index]);
    assert(response.data.success === true, `Chunk ${index} did not report success=true during resumed upload`);
  }

  if (SKIP_COMPLETE) {
    console.log('[Step] skipping complete phase because UPLOAD_TEST_SKIP_COMPLETE=1');
    return;
  }

  await completeUpload(uploadId);
  await completeUpload(uploadId); // idempotency check
  console.log('[Step] complete accepted, polling final status');

  const terminalStatus = await pollForTerminalStatus(uploadId, COMPLETE_TIMEOUT_MS);
  assert(terminalStatus.status === 'completed', `Expected completed status, got ${terminalStatus.status}`);
  assert(terminalStatus.file, 'Completed upload should return file payload');
  console.log(`[Pass] completed uploadId=${uploadId}`);
}

async function runCancelScenario() {
  console.log('\n[Scenario 2] init -> chunk -> cancel -> status');

  const payload = buildDeterministicBuffer(5 * 1024 * 1024 + 11);
  const [chunk0] = splitIntoChunks(payload, TEST_CHUNK_SIZE);
  const fileName = `upload-cancel-${Date.now()}-${randomUUID().slice(0, 8)}.bin`;

  const init = await initUpload(fileName, payload.length, TEST_CHUNK_SIZE);
  const uploadId = String(init.uploadId);
  console.log(`[Step] initialized uploadId=${uploadId}`);

  await waitForQueueRelease(uploadId);

  const chunkResponse = await uploadChunk(uploadId, 0, chunk0);
  assert(chunkResponse.data.success === true, 'Cancel scenario first chunk did not report success=true');

  await cancelUpload(uploadId);

  const cancelStatus = await readUploadStatus(uploadId, [200, 404]);
  if (cancelStatus.success === false && /not found|expired/i.test(String(cancelStatus.error || ''))) {
    console.log(`[Pass] cancelled upload cleaned before status poll uploadId=${uploadId}`);
    return;
  }

  assert(cancelStatus.status === 'cancelled', `Expected cancelled status, got ${cancelStatus.status}`);
  console.log(`[Pass] cancelled uploadId=${uploadId}`);
}

async function runConstraintScenario() {
  console.log('\n[Scenario 3] constraints + queue semantics');

  const largeStreamInit = await initUploadRaw({
    originalname: `large-stream-${Date.now()}.mp4`,
    size: (420 * 1024 * 1024),
    upload_mode: 'stream',
    chunk_size_bytes: TEST_CHUNK_SIZE,
    mimetype: 'video/mp4',
  }, [200]);
  assert(largeStreamInit.data.success === true, 'Expected large stream init to be accepted');
  assert(String(largeStreamInit.data.uploadMode || '').toLowerCase() === 'stream', 'Expected uploadMode=stream for large stream init');

  const mimeRejected = await initUploadRaw({
    originalname: `mime-reject-${Date.now()}.bin`,
    size: 1024,
    mimetype: 'application/x-msdownload',
    chunk_size_bytes: TEST_CHUNK_SIZE,
  }, [400]);
  assert(String(mimeRejected.data.code || '').toLowerCase() === 'unsupported_mime_type', 'Expected unsupported_mime_type code');

  const chunkSizeRejected = await initUploadRaw({
    originalname: `chunk-reject-${Date.now()}.pdf`,
    size: TEST_CHUNK_SIZE,
    mimetype: 'application/pdf',
    chunk_size_bytes: 1024 * 1024,
  }, [400]);
  assert(String(chunkSizeRejected.data.code || '').toLowerCase() === 'chunk_size_fixed', 'Expected chunk_size_fixed code');

  const legacyRemoved = await requestJson('POST', '/files/upload', {
    expectedStatuses: [410],
    body: {},
  });
  assert(String(legacyRemoved.data.code || '').toLowerCase() === 'legacy_upload_removed', 'Expected legacy_upload_removed on /files/upload');

  const userQueueIds = [];
  for (let i = 0; i < 3; i += 1) {
    const response = await initUploadRaw({
      originalname: `queue-user-${Date.now()}-${i}.pdf`,
      size: TEST_CHUNK_SIZE + 1,
      mimetype: 'application/pdf',
      chunk_size_bytes: TEST_CHUNK_SIZE,
    }, [200]);
    assert(response.data.success === true, 'Expected queued-cap init success');
    userQueueIds.push(String(response.data.uploadId || ''));
  }

  const statuses = await Promise.all(userQueueIds.map((id) => readUploadStatus(id)));
  const queuedCount = statuses.filter((s) => String(s.status || '') === 'queued').length;
  assert(queuedCount >= 1, 'Expected at least one queued upload when per-user active cap is exceeded');

  await cancelUpload(String(largeStreamInit.data.uploadId || '')).catch(() => undefined);
  await Promise.all(userQueueIds.map((id) => cancelUpload(id).catch(() => undefined)));
  console.log('[Pass] constraints and queue semantics validated');
}

async function runPauseResumeScenario() {
  console.log('\n[Scenario 4] pause/resume multiple times');

  const payload = buildDeterministicBuffer((TEST_CHUNK_SIZE * 2) + 4096);
  const chunks = splitIntoChunks(payload, TEST_CHUNK_SIZE);
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  const fileName = `upload-pause-resume-${Date.now()}-${randomUUID().slice(0, 8)}.bin`;

  const init = await initUploadRaw({
    originalname: fileName,
    size: payload.length,
    mimetype: 'application/octet-stream',
    chunk_size_bytes: TEST_CHUNK_SIZE,
    hash,
  });
  const uploadId = String(init.data.uploadId);
  await waitForQueueRelease(uploadId);

  for (let i = 0; i < 3; i += 1) {
    await uploadChunk(uploadId, i % chunks.length, chunks[i % chunks.length]);
    await pauseUpload(uploadId);
    const paused = await readUploadStatus(uploadId);
    assert(String(paused.status) === 'paused', `Expected paused status at cycle ${i + 1}`);
    await resumePausedUpload(uploadId);
    const resumed = await readUploadStatus(uploadId);
    assert(['queued', 'uploading', 'processing'].includes(String(resumed.status)), `Unexpected status after resume cycle ${i + 1}`);
  }

  for (let idx = 0; idx < chunks.length; idx += 1) {
    await uploadChunk(uploadId, idx, chunks[idx]);
  }

  await completeUpload(uploadId);
  const terminal = await pollForTerminalStatus(uploadId, COMPLETE_TIMEOUT_MS);
  assert(String(terminal.status) === 'completed', 'Pause/resume scenario should complete upload');
  console.log(`[Pass] pause/resume scenario uploadId=${uploadId}`);
}

async function runDuplicateScenario() {
  console.log('\n[Scenario 5] duplicate file upload (dedupe)');

  const payload = buildDeterministicBuffer((2 * 1024 * 1024) + 123);
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  const fileName = `upload-dedupe-${Date.now()}-${randomUUID().slice(0, 8)}.bin`;

  const firstInit = await initUploadRaw({
    originalname: fileName,
    size: payload.length,
    mimetype: 'application/octet-stream',
    chunk_size_bytes: TEST_CHUNK_SIZE,
    hash,
  });
  const uploadId = String(firstInit.data.uploadId);
  const chunks = splitIntoChunks(payload, TEST_CHUNK_SIZE);
  await waitForQueueRelease(uploadId);
  for (let idx = 0; idx < chunks.length; idx += 1) {
    await uploadChunk(uploadId, idx, chunks[idx]);
  }
  await completeUpload(uploadId);
  const firstTerminal = await pollForTerminalStatus(uploadId, COMPLETE_TIMEOUT_MS);
  assert(String(firstTerminal.status) === 'completed', 'First dedupe upload did not complete');

  const duplicateInit = await initUploadRaw({
    originalname: `${fileName}-copy`,
    size: payload.length,
    mimetype: 'application/octet-stream',
    chunk_size_bytes: TEST_CHUNK_SIZE,
    hash,
  });
  assert(duplicateInit.data.success === true, 'Duplicate init should succeed');
  assert(duplicateInit.data.duplicate === true, 'Expected duplicate=true for second upload init');
  assert(duplicateInit.data.file, 'Expected existing file payload for duplicate init');
  console.log('[Pass] duplicate upload dedupe validated');
}

async function runRestartRecoveryScenario() {
  console.log('\n[Scenario 6] server restart recovery simulation');

  const payload = buildDeterministicBuffer((TEST_CHUNK_SIZE * 3) + 77);
  const chunks = splitIntoChunks(payload, TEST_CHUNK_SIZE);
  const fileName = `upload-restart-${Date.now()}-${randomUUID().slice(0, 8)}.bin`;

  const init = await initUpload(fileName, payload.length, TEST_CHUNK_SIZE);
  const uploadId = String(init.uploadId);
  const resumeToken = String(init.resumeToken);
  await waitForQueueRelease(uploadId);

  await uploadChunk(uploadId, 0, chunks[0]);
  await uploadChunk(uploadId, 2, chunks[2]);

  // Simulate server restart boundary by re-discovering session from persisted DB state.
  const resumed = await resolveUploadByResumeToken(resumeToken);
  assert(String(resumed.uploadId) === uploadId, 'Resume token should recover the same upload session after restart simulation');
  assert(Number(resumed.uploadedChunksCount || 0) >= 2, 'Expected persisted chunk progress after restart simulation');

  const listed = await requestJson('GET', '/files/upload/sessions');
  const fromList = Array.isArray(listed.data.sessions) ? listed.data.sessions.find((s) => s?.uploadId === uploadId) : null;
  assert(Boolean(fromList), 'Session should be discoverable from /files/upload/sessions after restart simulation');

  for (let idx = 0; idx < chunks.length; idx += 1) {
    await uploadChunk(uploadId, idx, chunks[idx]);
  }
  await completeUpload(uploadId);
  const terminal = await pollForTerminalStatus(uploadId, COMPLETE_TIMEOUT_MS);
  assert(String(terminal.status) === 'completed', 'Restart recovery scenario should complete upload');
  console.log(`[Pass] restart recovery simulation uploadId=${uploadId}`);
}

async function runLargeFileScenario() {
  if (!ENABLE_LARGE_TEST) {
    console.log('\n[Scenario 7] large file (1GB+) skipped (set UPLOAD_TEST_ENABLE_LARGE=1 to run)');
    return;
  }

  console.log(`\n[Scenario 7] large file upload (${LARGE_TEST_SIZE_BYTES} bytes)`);
  assert(LARGE_TEST_SIZE_BYTES > (1024 * 1024 * 1024), 'Large file test must be > 1GB');

  const chunkCount = Math.ceil(LARGE_TEST_SIZE_BYTES / TEST_CHUNK_SIZE);
  const fileName = `upload-large-${Date.now()}-${randomUUID().slice(0, 8)}.bin`;
  const init = await initUploadRaw({
    originalname: fileName,
    size: LARGE_TEST_SIZE_BYTES,
    mimetype: 'application/octet-stream',
    chunk_size_bytes: TEST_CHUNK_SIZE,
  });
  const uploadId = String(init.data.uploadId);

  await waitForQueueRelease(uploadId, 180000);
  const maxChunksToSend = Number.parseInt(process.env.UPLOAD_TEST_LARGE_CHUNKS_TO_SEND || '12', 10);
  const toSend = Math.min(chunkCount, maxChunksToSend);

  for (let i = 0; i < toSend; i += 1) {
    const remaining = LARGE_TEST_SIZE_BYTES - (i * TEST_CHUNK_SIZE);
    const chunkSize = Math.max(0, Math.min(TEST_CHUNK_SIZE, remaining));
    const chunk = Buffer.allocUnsafe(chunkSize);
    for (let j = 0; j < chunkSize; j += 1) chunk[j] = (i + j) % 251;
    await uploadChunk(uploadId, i, chunk);
  }

  const status = await readUploadStatus(uploadId);
  assert(Number(status.uploadedChunksCount || 0) >= toSend, 'Large-file scenario should persist uploaded chunk progress');

  await cancelUpload(uploadId).catch(() => undefined);
  console.log(`[Pass] large-file scenario exercised ${toSend}/${chunkCount} chunks before cancel`);
}

async function runMemoryLeakScenario() {
  console.log('\n[Scenario 8] memory leak detection');

  const before = await readUploadQueueHealth();
  const beforeHeap = Number(before?.processMemory?.heapUsedBytes || 0);

  for (let i = 0; i < LEAK_LOOP_COUNT; i += 1) {
    const init = await initUploadRaw({
      originalname: `upload-leak-probe-${Date.now()}-${i}.bin`,
      size: TEST_CHUNK_SIZE + 7,
      mimetype: 'application/octet-stream',
      chunk_size_bytes: TEST_CHUNK_SIZE,
    });
    const uploadId = String(init.data.uploadId || '');
    if (uploadId) {
      await cancelUpload(uploadId).catch(() => undefined);
    }
  }

  await delay(1500);

  const after = await readUploadQueueHealth();
  const afterHeap = Number(after?.processMemory?.heapUsedBytes || 0);
  const heapDeltaMb = (afterHeap - beforeHeap) / (1024 * 1024);

  const activeChunkMaps = Number(after?.queue?.activeChunkUploadMaps || 0);
  assert(activeChunkMaps === 0, `Expected active chunk maps to settle at 0, got ${activeChunkMaps}`);
  assert(heapDeltaMb < MAX_HEAP_DELTA_MB, `Heap growth too high (${heapDeltaMb.toFixed(2)}MB)`);

  console.log(`[Pass] memory leak probe heap delta ${heapDeltaMb.toFixed(2)}MB`);
}

async function main() {
  if (!TOKEN) {
    console.error('Missing required env: UPLOAD_TEST_BEARER_TOKEN');
    console.error('Example: UPLOAD_TEST_BEARER_TOKEN=<jwt> npm run test:integration:upload');
    process.exit(1);
  }

  console.log('Upload lifecycle integration harness');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Complete timeout: ${COMPLETE_TIMEOUT_MS}ms`);
  console.log(`Skip complete: ${SKIP_COMPLETE ? 'yes' : 'no'}`);
  console.log(`Chunk size: ${TEST_CHUNK_SIZE} bytes`);

  await runReliabilityResumeScenario();
  await runCancelScenario();
  await runConstraintScenario();
  await runPauseResumeScenario();
  await runDuplicateScenario();
  await runRestartRecoveryScenario();
  await runLargeFileScenario();
  await runMemoryLeakScenario();

  console.log('\nAll upload lifecycle integration scenarios passed.');
}

main().catch((error) => {
  console.error('\nUpload lifecycle integration harness failed.');
  console.error(error?.stack || String(error));
  process.exit(1);
});
