import { RoomCanvas } from "@/component/RoomCanvas";

/**
 * The board page, prerendered once and reused for every canvas.
 *
 * This used to `await params` to read the slug, which is a dynamic API - so
 * Next rendered the route on the server for every request, for every board,
 * forever. The output never varied: the whole page is one client component
 * that loads the board itself over HTTP and a WebSocket. The server was
 * rendering the same handful of bytes again and again, personalising nothing.
 *
 * `force-static` makes it a single prerendered shell. The slug is read from
 * the URL on the client, where everything that depends on it already lives,
 * and the personalised part - which board, whose shapes, whether you may even
 * open it - stays exactly where it was: fetched after hydration, against a
 * token the server never sees at render time.
 */
export const dynamic = "force-static";

export default function CanvasPage() {
  return <RoomCanvas />;
}
