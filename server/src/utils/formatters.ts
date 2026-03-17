/**
 * Shared formatting helpers used by both file.controller and upload.controller.
 * Single source of truth — avoids drift between the two copies.
 */

import { getMessageCacheState } from '../services/share-v2/telegram-read-cache.service';

// ── formatFileRow ────────────────────────────────────────────────────────────
// Normalizes a raw `files` DB row into the standard API response shape.

export const formatFileRow = (row: any) => ({
    id: row.id,
    name: row.file_name,
    folder_id: row.folder_id,
    size: row.file_size,
    mime_type: row.mime_type,
    telegram_chat_id: row.telegram_chat_id,
    is_starred: row.is_starred,
    is_trashed: row.is_trashed,
    trashed_at: row.trashed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    blurhash: row.blurhash || null,
    pointer_health: row.pointer_health || null,
    cache_state: row.cache_state || getMessageCacheState(String(row.telegram_chat_id || ''), Number(row.telegram_message_id || 0)),
    segment_mode_enabled: Boolean(row.segment_mode_enabled),
    thumbnail_url: row.mime_type?.startsWith('image/') || row.mime_type?.startsWith('video/')
        ? `${process.env.SERVER_BASE_URL || ''}/api/files/${row.id}/thumbnail`
        : null,
});

// ── extractTelegramNativeMeta ────────────────────────────────────────────────
// Pulls width/height/duration/caption from a Telegram message after upload.

export const extractTelegramNativeMeta = (uploadedMessage: any) => {
    const media = uploadedMessage?.document || uploadedMessage?.photo || null;
    const attrs = Array.isArray(uploadedMessage?.document?.attributes) ? uploadedMessage.document.attributes : [];
    const videoAttr = attrs.find((a: any) => a?.className === 'DocumentAttributeVideo' || a?.duration || a?.w || a?.h) || null;
    const audioAttr = attrs.find((a: any) => a?.className === 'DocumentAttributeAudio' || a?.duration || a?.title || a?.performer) || null;
    const imageAttr = attrs.find((a: any) => a?.className === 'DocumentAttributeImageSize' || a?.w || a?.h) || null;

    const width = Number(videoAttr?.w || imageAttr?.w || 0) || null;
    const height = Number(videoAttr?.h || imageAttr?.h || 0) || null;
    const durationSec = Number(videoAttr?.duration || audioAttr?.duration || 0) || null;
    const caption = String(uploadedMessage?.message || '').trim() || null;

    return {
        mediaMeta: {
            dc_id: media?.dcId || null,
            mime_type: uploadedMessage?.document?.mimeType || null,
            has_photo: Boolean(uploadedMessage?.photo),
            has_document: Boolean(uploadedMessage?.document),
        },
        durationSec,
        width,
        height,
        caption,
    };
};
