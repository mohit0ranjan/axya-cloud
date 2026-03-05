import SharedSpaceClient from './shared-space-client';

export default async function SharedSpacePage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  return <SharedSpaceClient spaceId={spaceId} />;
}
