import { RoomCanvas } from "@/component/RoomCanvas";

export default async function CanvasPage({ params }: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <RoomCanvas slug={slug} />;
}