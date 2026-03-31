import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { sendApiError } from '../utils/apiError';

const getZodIssues = (error: ZodError) => {
    const issueSource = (error as any).issues || (error as any).errors || [];
    return Array.isArray(issueSource) ? issueSource : [];
};

export const globalErrorHandler = (
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    let statusCode = 500;
    let code = 'internal_error';
    let message = 'An unexpected error occurred';
    let details: any = undefined;
    const requestId = String((req as any).requestId || req.headers['x-request-id'] || '').trim() || null;

    if (err instanceof SyntaxError && (err as any).status === 400 && 'body' in err) {
        statusCode = 400;
        code = 'invalid_json';
        message = 'Malformed JSON request body';
    } else if (err instanceof ZodError) {
        const zodErr = err as any;
        statusCode = 400;
        code = 'validation_error';
        message = 'Invalid request parameters';
        details = getZodIssues(zodErr).map((e: any) => ({ path: (e.path || []).join('.'), message: e.message }));
    } else if (err instanceof AppError) {
        statusCode = err.statusCode;
        code = err.code;
        message = err.message;
        details = err.details;
    } else {
        statusCode = err.status || err.statusCode || 500;
        code = String(err.code || code);
        message = err.message || message;
    }

    if (statusCode >= 500) {
        logger.error('express', 'unhandled_exception', {
            path: req.path,
            method: req.method,
            error: err.stack || err.message,
            statusCode,
            code,
            requestId,
        });
    } else {
        logger.warn('express', 'handled_request_error', {
            path: req.path,
            method: req.method,
            message,
            statusCode,
            code,
            requestId,
        });
    }

    // Express 5 sends response headers automatically if headersSent is true, so avoid double response
    if (res.headersSent) {
        return next(err);
    }

    return sendApiError(res, statusCode, code, message, {
        retryable: statusCode >= 500,
        details: {
            ...(details !== undefined ? { validation: details } : {}),
            ...(requestId ? { requestId } : {}),
        },
    });
};
