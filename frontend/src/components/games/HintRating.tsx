import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { rateHint } from "@/lib/arcadeApi";
import "./hint-rating.css";

/** "Was this hint helpful?" under a hint; the answer is logged with the hint for the study. */
export function HintRating({ runId, hintId }: { runId: string; hintId: number }) {
  const [rated, setRated] = useState<{ id: number; helpful: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const done = rated?.id === hintId;

  function rate(helpful: boolean) {
    setFailed(false);
    rateHint(runId, hintId, helpful).then(() => setRated({ id: hintId, helpful })).catch(() => setFailed(true));
  }

  if (done) return <p className="hint-rating" role="status">Salamat! Thanks for rating this hint.</p>;
  return (
    <div className="hint-rating" role="group" aria-label="Was this hint helpful?">
      <span>Nakatulong ba ang pahiwatig?</span>
      <button type="button" className="pop-button pop-quiet" onClick={() => rate(true)}><ThumbsUp size={15} aria-hidden="true" /> Oo</button>
      <button type="button" className="pop-button pop-quiet" onClick={() => rate(false)}><ThumbsDown size={15} aria-hidden="true" /> Hindi</button>
      {failed && <small role="alert">Couldn’t save that. Try again.</small>}
    </div>
  );
}
