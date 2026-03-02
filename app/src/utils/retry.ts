import { AxiosError } from 'axios';

/**
 * Halts execution for the specified milliseconds
 */
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Determines if a failed request should be retried.
 * - Retries on NO response (Network Error / Server asleep completely)
 * - Retries on 500-599 Gateway/Server errors (Render 502/503 cold starts)
 * - Retries on 408 Request Timeout
 */
export const shouldRetry = (error: AxiosError): boolean => {
    // 1. Network errors (no response from server)
    if (!error.response && error.code !== 'ECONNABORTED') {
        return true;
    }

    // 2. Gateway/Server Errors or Timeout
    if (error.response) {
        const status = error.response.status;
        if (status >= 500 && status <= 599) return true;
        if (status === 408) return true;
    }

    // 3. Client timeout
    if (error.code === 'ECONNABORTED') {
        return true;
    }

    return false;
};
