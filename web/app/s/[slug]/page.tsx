import ShareV2Client from './share-v2-client';

export default async function ShareV2Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ShareV2Client slug={slug} />;
}
