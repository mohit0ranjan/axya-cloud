import RequestUploader from "./request-uploader";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <RequestUploader slug={slug} />;
}
