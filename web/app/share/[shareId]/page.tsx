import ShareClient from './share-client';

export default async function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  return <ShareClient shareId={shareId} />;
}
