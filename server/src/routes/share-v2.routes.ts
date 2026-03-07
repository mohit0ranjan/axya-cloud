import express from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import {
    createShareItemTicketV2,
    createShareV2,
    deleteShareV2,
    downloadAllShareZipV2,
    getShareZipJobV2,
    getPublicShareMetaV2,
    listPublicShareItemsV2,
    listSharesV2,
    openPublicShareV2,
    patchShareV2,
    streamShareItemV2,
} from '../controllers/share-v2.controller';

const router = express.Router();

// Owner APIs (authenticated)
router.post('/shares', requireAuth, createShareV2);
router.get('/shares', requireAuth, listSharesV2);
router.patch('/shares/:id', requireAuth, patchShareV2);
router.delete('/shares/:id', requireAuth, deleteShareV2);

// Public APIs
router.post('/public/shares/:slug/open', openPublicShareV2);
router.get('/public/shares/:slug/meta', getPublicShareMetaV2);
router.get('/public/shares/:slug/items', listPublicShareItemsV2);
router.post('/public/shares/:slug/items/:itemId/preview-ticket', createShareItemTicketV2);
router.get('/public/stream/:ticket', streamShareItemV2);
router.get('/public/shares/:slug/download-all', downloadAllShareZipV2);
router.get('/public/shares/:slug/zip-jobs/:jobId', getShareZipJobV2);

export default router;
