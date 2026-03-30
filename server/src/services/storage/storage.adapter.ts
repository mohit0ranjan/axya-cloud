export type StorageUploadRequest = {
    ownerSessionString: string;
    requestedChatId: string;
    filePath: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    caption?: string;
    onProgress?: (fraction: number) => void;
};

export type StorageUploadResult = {
    provider: 'telegram' | 's3' | 'azure_blob' | 'custom';
    providerFileId: string;
    providerMessageId: string;
    storageChatId: string;
    providerContext?: Record<string, string>;
    nativeMeta: {
        mediaMeta: Record<string, unknown>;
        durationSec: number | null;
        width: number | null;
        height: number | null;
        caption: string | null;
    };
};

export interface StorageAdapter {
    readonly providerName: StorageUploadResult['provider'];
    uploadFile(request: StorageUploadRequest): Promise<StorageUploadResult>;
}
