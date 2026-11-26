import { SceneLocation } from '@/components/app/scene-location';

export default async function SceneLocationPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = await params;
  return <SceneLocation locationId={locationId} />;
}
