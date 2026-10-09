import { notFound } from 'next/navigation';
import UploadDiagnostics from './UploadDiagnostics';

export default function UploadTestPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <UploadDiagnostics />;
}
