import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../utils/AppError';

const getZodIssues = (error: ZodError) => {
    const issueSource = (error as any).issues || (error as any).errors || [];
    return Array.isArray(issueSource) ? issueSource : [];
};

export const validateRequest = (schema: ZodSchema<any>) => {
    return async (req: Request, _res: Response, next: NextFunction) => {
        try {
            const parsed = await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
            });
            // Push sanitized/coerced values back to request for downstream handlers.
            if (parsed && typeof parsed === 'object') {
                if ('body' in parsed) req.body = (parsed as any).body;
                if ('query' in parsed) req.query = (parsed as any).query;
                if ('params' in parsed) req.params = (parsed as any).params;
            }
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                const issues = getZodIssues(error);
                const errMessage = issues.map((e: any) => `${(e.path || []).join('.')}: ${e.message}`).join(', ');
                next(new ValidationError(`Validation failed: ${errMessage}`, issues));
            } else {
                next(error);
            }
        }
    };
};
