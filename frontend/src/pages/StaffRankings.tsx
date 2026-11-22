import { useState } from "react";
import { ChevronLeft, ChevronRight, Trophy, Users } from "lucide-react";
import { ArcadeSelect } from "@/components/ui/ArcadeSelect";
import { MINIGAMES } from "@/data/landingData";
import { supabaseClient } from "@/lib/auth";
import { useRemote } from "./adminActions";
import { Avatar, LoadState, PageHeader, SkeletonTable } from "./StaffKit";

const PAGE_SIZE = 20;

interface Ranking {
  player_name: string;
  place: number | null;
  score: number | null;
  avatar?: string | null;
  level?: number | null;
}

// Same ranking functions the learner Rankings tab uses, so staff see exactly what learners see.
async function loadRankings(gameId: number | null, page: number, signal: AbortSignal) {
  if (!supabaseClient) throw new Error("Rankings are unavailable.");
  const args = { requested_game: gameId, page_offset: page * PAGE_SIZE };
  let result = await supabaseClient.rpc("pandiwasto_rankings_profiles", args).abortSignal(signal);
  if (result.error?.code === "PGRST202") result = await supabaseClient.rpc("pandiwasto_rankings", args).abortSignal(signal);
  if (result.error) throw result.error;
  return (result.data ?? []) as Ranking[];
}

export function StaffRankings() {
  const [gameId, setGameId] = useState<number | null>(MINIGAMES[0].id);
  const [page, setPage] = useState(0);
  const rankings = useRemote((signal) => loadRankings(gameId, page, signal), `rankings:${gameId}:${page}`);
  const allPlayers = gameId === null;
  const rows = rankings.state.status === "ready" ? rankings.state.data : [];

  return (
    <>
      <PageHeader title="Rankings" description="The same leaderboards learners see. Hidden scores and private profiles stay hidden here too."
        actions={(
          <>
            <div className="st-segment" role="group" aria-label="Rankings view">
              <button type="button" aria-pressed={!allPlayers} onClick={() => { setGameId(MINIGAMES[0].id); setPage(0); }}><Trophy size={15} aria-hidden="true" /> Leaderboard</button>
              <button type="button" aria-pressed={allPlayers} onClick={() => { setGameId(null); setPage(0); }}><Users size={15} aria-hidden="true" /> All players</button>
            </div>
            {!allPlayers && (
              <ArcadeSelect className="st-select st-select-header" label="Game" hideLabel value={String(gameId)}
                onValueChange={(value) => { setGameId(Number(value)); setPage(0); }}
                options={MINIGAMES.map((game) => ({ value: String(game.id), label: game.gameName }))} />
            )}
          </>
        )} />
      <section className="st-card" aria-label={allPlayers ? "All players" : "Leaderboard"}>
        {rankings.state.status !== "ready"
          ? <LoadState status={rankings.state.status} what="rankings" onRetry={rankings.reload} skeleton={<SkeletonTable rows={6} cols={allPlayers ? 2 : 3} />} />
          : (
            <>
              <div className="st-table-wrap">
                <table className="st-table">
                  <thead><tr>{!allPlayers && <th scope="col">Rank</th>}<th scope="col">Player</th>{!allPlayers && <th scope="col">Best score</th>}</tr></thead>
                  <tbody>
                    {rows.slice(0, PAGE_SIZE).map((row, index) => (
                      <tr key={row.player_name + index}>
                        {!allPlayers && <td><span className={row.place && row.place <= 3 ? "st-rank st-rank-top" : "st-rank"}>{row.place}</span></td>}
                        <th scope="row">
                          <span className="st-person">
                            <Avatar name={row.player_name} student avatar={row.avatar} size={34} />
                            <span><strong>{row.player_name}</strong><small>{row.level == null ? "Level private" : `Level ${row.level}`}</small></span>
                          </span>
                        </th>
                        {!allPlayers && <td><strong>{row.score?.toLocaleString()}</strong> pts</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && <p className="st-empty">{page > 0 ? "No more results." : allPlayers ? "No players yet." : "No scores for this game yet."}</p>}
              </div>
              <div className="st-pager">
                <span>Page {page + 1}</span>
                <button type="button" className="st-icon-button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
                <button type="button" className="st-icon-button" aria-label="Next page" disabled={rows.length <= PAGE_SIZE} onClick={() => setPage(page + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
              </div>
            </>
          )}
      </section>
    </>
  );
}
