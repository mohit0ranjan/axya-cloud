/** Legacy URLs delegate to the same private range gateway and cache as /files. */
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { streamFile, streamFileStatus } from './file.controller';

export const streamMedia = (req: AuthRequest, res: Response) => {
    req.params.id = req.params.fileId;
    return streamFile(req, res);
};
export const streamStatus = (req: AuthRequest, res: Response) => {
    req.params.id = req.params.fileId;
    return streamFileStatus(req, res);
};
