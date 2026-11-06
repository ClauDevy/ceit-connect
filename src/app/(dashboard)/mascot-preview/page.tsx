import { notFound } from "next/navigation";
import { Mascot, type MascotPose } from "@/components/ui/mascot";

const poses: Array<{ pose: MascotPose; where: string }> = [
  { pose: "sleeping", where: "Empty lists" },
  { pose: "celebrating", where: "Event launched, phase complete" },
  { pose: "searching", where: "No search results" },
  { pose: "oops", where: "404 and error pages" },
  { pose: "waving", where: "Login and welcome" },
];

// Development-only gallery so the tiger poses can be checked in both themes.
export default function MascotPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-2 gap-8 py-8 sm:grid-cols-3">
      {poses.map(({ pose, where }) => (
        <figure key={pose} className="flex flex-col items-center gap-2 text-center">
          <Mascot pose={pose} size={140} />
          <figcaption className="text-sm">
            <span className="font-semibold">{pose}</span>
            <span className="block text-xs text-muted-foreground">{where}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
