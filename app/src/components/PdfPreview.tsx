import React from 'react';
import DocumentPreviewCard from './DocumentPreviewCard';

type Props = { baseUrl: string; fileId: string; token: string; name: string; active: boolean; sizeBytes: number; revision?: string; offlineUri?: string };

export default function PdfPreview({ name }: Props) {
  return <DocumentPreviewCard name={name} mimeType="application/pdf" />;
}
