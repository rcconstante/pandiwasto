import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Star, Trophy, Users, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { supabaseClient } from "@/lib/auth";
import { avatarSrc, readAvatar, type AvatarId } from "@/data/dashboardProfile";
import { MINIGAMES } from "@/data/landingData";

const PAGE_SIZE = 20;

interface Ranking {
  player_name: string;
  place: number | null;
  score: number | null;
  is_you: boolean;
  avatar?: string | null;
  level?: number | null;
}

export function DashboardRankings({ initialGameId, localPlayer }: {
  initialGameId: number;
  localPlayer?: { name: string; avatar: AvatarId; level: number; bestScores: Record<number, number> };
}) {
  const [gameId, setGameId] = useState(initialGameId);
  const [view, setView] = useState<"scores" | "players">("scores");
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const allPlayers = view === "players";
  const localScore = localPlayer?.bestScores[gameId] ?? 0;
  const localRows = localPlayer && (allPlayers || localScore > 0)
    ? [{
        player_name: localPlayer.name,
        place: allPlayers ? null : 1,
        score: allPlayers ? null : localScore,
        is_you: true,
        avatar: localPlayer.avatar,
        level: localPlayer.level,
      }]
    : [];

  return (
    <section className="pwd-rankings" aria-labelledby="pwd-rankings-title">
      <h2 id="pwd-rankings-title">Rankings</h2>
      <div className="pwd-ranking-views" role="group" aria-label="Rankings view">
        <button type="button" aria-pressed={!allPlayers} onClick={() => { setView("scores"); setPage(0); }}>
          <Trophy size={17} aria-hidden="true" /> Leaderboard
        </button>
        <button type="button" aria-pressed={allPlayers} onClick={() => { setView("players"); setPage(0); }}>
          <Users size={17} aria-hidden="true" /> All Players
        </button>
      </div>
      {!allPlayers && (
        <label className="pwd-ranking-game">
          Choose a game
          <select value={gameId} onChange={(event) => { setGameId(Number(event.target.value)); setPage(0); }}>
            {MINIGAMES.map((game) => <option key={game.id} value={game.id}>{game.gameName}</option>)}
          </select>
        </label>
      )}
      {localPlayer ? (
        <>
          <p className="pwd-ranking-scope">Players and scores on this device</p>
          {localRows.length ? <RankingTable key={`${view}:${gameId}`} rows={localRows} allPlayers={allPlayers} /> : (
            <p className="pwd-ranking-empty" role="status">No scores saved for this game yet.</p>
          )}
        </>
      ) : (
        <RankingPage
          key={`${view}:${gameId}:${page}:${retry}`}
          gameId={allPlayers ? null : gameId}
          page={page}
          onPageChange={setPage}
          onRetry={() => setRetry((count) => count + 1)}
        />
      )}
    </section>
  );
}

function RankingTable({ rows, allPlayers }: { rows: Ranking[]; allPlayers: boolean }) {
  const [selected, setSelected] = useState<Ranking | null>(null);
  const profileTrigger = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <table className="pwd-ranking-table">
        <caption className="sr-only">{allPlayers ? "All players" : "Best scores for this game"}</caption>
        <thead><tr>{!allPlayers && <th scope="col">Rank</th>}<th scope="col">Player</th>{!allPlayers && <th scope="col">Best score</th>}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {!allPlayers && <td>{row.place}</td>}
              <th scope="row">
                <button type="button" className="pwd-ranking-player" aria-haspopup="dialog" onClick={(event) => {
                  profileTrigger.current = event.currentTarget;
                  setSelected(row);
                }}>
                  <img src={avatarSrc(readAvatar(row.avatar) ?? "chick")} alt="" width="40" height="40" />
                  <span>
                    <span className="sr-only">View profile for </span>{row.player_name}
                    {row.is_you && <span className="pwd-ranking-you">You</span>}
                    <small>{row.level == null ? "Level unavailable" : `Level ${row.level}`}</small>
                  </span>
                </button>
              </th>
              {!allPlayers && <td>{row.score?.toLocaleString()}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog.Root open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="pw-modal-overlay" />
          <Dialog.Content className="pw-modal pwd-ranking-profile" onCloseAutoFocus={(event) => {
            event.preventDefault();
            profileTrigger.current?.focus();
          }}>
            {selected && (
              <>
                <Dialog.Close className="pw-modal-close" aria-label="Close profile"><X size={19} aria-hidden="true" /></Dialog.Close>
                <img src={avatarSrc(readAvatar(selected.avatar) ?? "chick")} alt="" width="96" height="96" />
                <Dialog.Title>{selected.player_name}</Dialog.Title>
                <Dialog.Description className="sr-only">Player profile</Dialog.Description>
                <p className="pwd-level"><Star size={17} aria-hidden="true" /> {selected.level == null ? "Level unavailable" : `Level ${selected.level}`}</p>
                {selected.score != null && <p>Best score for this game <strong>{selected.score.toLocaleString()} pts</strong></p>}
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function RankingPage({ gameId, page, onPageChange, onRetry }: {
  gameId: number | null;
  page: number;
  onPageChange: (page: number) => void;
  onRetry: () => void;
}) {
  const [rows, setRows] = useState<Ranking[] | null>(null);
  const [failed, setFailed] = useState(false);
  const allPlayers = gameId === null;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      if (!supabaseClient) return;
      try {
        const args = {
          requested_game: gameId,
          page_offset: page * PAGE_SIZE,
        };
        let result = await supabaseClient.rpc("pandiwasto_rankings_profiles", args).abortSignal(controller.signal);
        if (result.error?.code === "PGRST202" && !controller.signal.aborted) {
          result = await supabaseClient.rpc("pandiwasto_rankings", args).abortSignal(controller.signal);
        }
        if (result.error) throw result.error;
        if (!controller.signal.aborted) setRows(result.data ?? []);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => controller.abort();
  }, [gameId, page]);

  if (failed) {
    return (
      <div className="pwd-ranking-empty">
        <p role="alert">Rankings are unavailable right now.</p>
        <button className="pwd-save" type="button" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (!rows) return <p className="pwd-ranking-empty" role="status">Loading {allPlayers ? "players" : "scores"}…</p>;

  return (
    <>
      {rows.length === 0 ? (
        <p className="pwd-ranking-empty" role="status">
          {page > 0 ? "No more results." : allPlayers ? "No players have joined yet." : "No leaderboard scores yet."}
        </p>
      ) : (
        <RankingTable rows={rows.slice(0, PAGE_SIZE)} allPlayers={allPlayers} />
      )}
      {(page > 0 || rows.length > PAGE_SIZE) && (
        <nav className="pwd-ranking-pagination" aria-label="Rankings pages">
          <button type="button" className="pwd-save" disabled={page === 0} onClick={() => onPageChange(page - 1)}><ArrowLeft size={16} aria-hidden="true" /> Previous</button>
          <span>Page {page + 1}</span>
          <button type="button" className="pwd-save" disabled={rows.length <= PAGE_SIZE} onClick={() => onPageChange(page + 1)}>Next <ArrowRight size={16} aria-hidden="true" /></button>
        </nav>
      )}
    </>
  );
}
