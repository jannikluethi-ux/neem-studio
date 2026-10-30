import { createFileRoute } from "@tanstack/react-router";
import { bytesForCandidateVersion } from "@/lib/studio/image-record.server";

export const Route = createFileRoute("/studio-image/$version")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const version = Number(params.version);
        const file = Number.isInteger(version) ? await bytesForCandidateVersion(version) : null;
        if (!file) return new Response("That image version is not on record.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        const copy = Uint8Array.from(file.bytes);
        return new Response(copy, {
          headers: {
            "Content-Type": file.mediaType,
            "Content-Length": String(file.bytes.byteLength),
            "Cache-Control": "private, no-store",
            "Content-Disposition": `inline; filename="meethi-candidate-v${version}.jpg"`,
          },
        });
      },
    },
  },
});
