import { dealWhackDeck, whackWindow, WORD_TYPES } from "./items/whackGame.ts";
import { AFFIX_TYPES, applyAffix, buildTossRun, tileLabel } from "./items/tossGame.ts";
import { buildMemoryRun, memoryScore } from "./items/memoryGame.ts";
import { buildTicketRun, ticketWord, TICKET_LEVERS } from "./items/ticketGame.ts";
import { buildClawRun, CLAW_ROLES } from "./items/clawGame.ts";
import { buildFortuneRun, FORTUNE_HINTS } from "./items/fortuneGame.ts";

const ENGINE_VERSION = 1;
const CHOICE_ROUNDS = 5;
const MAX_WHACK_HITS = 200;
const MEMORY_PAUSE_MS = 1400;
const SKILLS = {
  2: "kayarian-ng-salita",
  4: "tambalan",
  5: "pag-uulit",
  6: "pokus-ng-pandiwa",
  7: "asimilasyon",
};

export class RankedMoveError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function feedback(kind, text, points = 0, answer) {
  return { kind, text, points, ...(answer ? { answer } : {}) };
}

function choiceRounds(gameId) {
  switch (gameId) {
    case 3: return buildTossRun(false).map((item) => {
      const { root, sentence, answerTile, choices } = item;
      const skill = answerTile.type;
      const word = applyAffix(root, answerTile);
      const type = AFFIX_TYPES.find(({ id }) => id === skill);
      return {
        itemId: skill + "-" + root,
        skill,
        view: { root, sentence, options: choices.map((tile) => ({ id: tile.type, label: tileLabel(tile), ...tile })) },
        answer: skill,
        summary: word,
        explanation: sentence.replace("___", word) + " " + type.label + ".",
        hint: type.clue,
      };
    });
    case 5: return buildTicketRun(false).map((item) => {
      const { root, sentence, kind, repeated } = item;
      const word = ticketWord(item);
      return {
        itemId: root,
        skill: SKILLS[5],
        view: { root, sentence, options: TICKET_LEVERS.map(({ kind: id, label }) => ({ id, label })) },
        answer: kind,
        summary: word,
        explanation: kind === "ganap" ? "Buong salitang " + root + " ang inulit." : "Ang bahaging " + repeated + " ang inulit sa " + root + ".",
        hint: "Basahin ang pangungusap. Kailangan bang ulitin ang buong salita, o ang unang pantig lamang?",
      };
    });
    case 6: return buildClawRun(false).map((item) => {
      const { role, verb, beforeFocus, subject, afterFocus, options, explanation } = item;
      return {
        itemId: verb.toLocaleLowerCase("fil"),
        skill: SKILLS[6],
        view: {
          sentence: [verb, beforeFocus, subject, afterFocus].filter(Boolean).join(" ") + ".",
          verb,
          options: options.map((id) => ({ id, label: CLAW_ROLES[id].label })),
        },
        answer: role,
        summary: CLAW_ROLES[role].label,
        explanation,
        hint: "Hanapin ang paksa na " + subject + ". Ano ang papel nito sa kilos?",
      };
    });
    case 7: return buildFortuneRun(false).map((item) => ({
      itemId: item.root,
      skill: SKILLS[7],
      view: { root: item.root, options: item.choices.map((word) => ({ id: word, label: word })) },
      answer: item.answer,
      summary: item.answer,
      explanation: FORTUNE_HINTS[item.prefix],
      hint: "Pakinggan ang unang tunog ng " + item.root + ". Paano ito babagay sa tunog sa dulo ng pang-?",
    }));
    default: throw new RankedMoveError(400, "This ranked game is unavailable.");
  }
}

function blankRound(state, now) {
  return { ...state, phase: "playing", feedback: null, hint: null, rejected: [], beganAt: now };
}

function blankMemoryBoard(state) {
  return { ...state, bankedScore: state.score, moves: 0, misses: 0, faceUp: [], matched: [], observed: [], hintCard: null, hideAt: null };
}

function nextWhack(state, now) {
  const index = state.deckIndex + 1;
  const newDeck = index >= state.deck.length;
  return blankRound({
    ...state,
    deck: newDeck ? dealWhackDeck(state.deck.at(-1).text) : state.deck,
    deckIndex: newDeck ? 0 : index,
    round: state.round + 1,
    deadline: state.mode === "practice" ? null : now + whackWindow(state.hits),
  }, now);
}

// Durable internal state includes answer keys and decks. Only projectRanked can expose a view.
export function createRankedState(gameId, mode, now = Date.now()) {
  if (mode === "practice" && gameId !== 2) throw new RankedMoveError(400, "Practice mode is only available for Whack-a-Word.");
  const state = blankRound({ engine: ENGINE_VERSION, gameId, mode, round: 0, score: 0, xp: 0, results: [] }, now);
  if (gameId === 2) {
    return withHintContext({ ...state, deck: dealWhackDeck(), deckIndex: 0, hearts: 3, hits: 0, deadline: mode === "practice" ? null : now + whackWindow(0) });
  }
  if (gameId === 4) return withHintContext(blankMemoryBoard({ ...state, boards: buildMemoryRun(false) }));
  return withHintContext({ ...state, rounds: choiceRounds(gameId) });
}

export function isRankedState(state, gameId) {
  return state?.engine === ENGINE_VERSION && state.gameId === gameId;
}

function observation(state, details, now, itemIndex = state.round) {
  return {
    skillId: details.skill,
    itemId: details.itemId,
    itemIndex,
    correct: details.correct,
    firstAttempt: details.firstAttempt,
    hintUsed: details.hintUsed,
    responseMs: Math.max(0, now - state.beganAt),
    ...(details.timedOut ? { timedOut: true } : {}),
  };
}

function getHintCard(state, board) {
  const first = state.hideAt === null ? state.faceUp[0] : undefined;
  return first ?? board.cards.findIndex((_, index) => !state.matched.includes(index));
}

function withHintContext(state) {
  let hintContext = null;
  if (state.phase === "playing" && !state.hint && state.gameId !== 2) {
    if (state.gameId === 4) {
      const board = state.boards[state.round];
      const card = board.cards[getHintCard(state, board)];
      if (card) {
        const pairIndex = board.pairs.findIndex(({ compound }) => compound === card.pair.compound);
        hintContext = { skillId: SKILLS[4], itemIndex: state.round * 10 + pairIndex };
      }
    } else {
      hintContext = { skillId: state.rounds[state.round].skill, itemIndex: state.round };
    }
  }
  return { ...state, hintContext };
}

function transition(state, { complete = false, abandon = false, observations = [], hintContext } = {}) {
  return { state: withHintContext(state), complete, abandon, observations, hintContext };
}

function reject(message = "That action is unavailable at this stage.") {
  throw new RankedMoveError(409, message);
}

function whackMove(state, action, now) {
  if (action.type === "finish" && state.hits > 0) return transition(state, { complete: true });
  if (action.type === "next" && state.phase === "review") return transition(nextWhack(state, now));
  if (state.phase !== "playing") return reject();
  if (action.type !== "timeout" && action.type !== "answer") return reject();

  const timedOut = state.deadline !== null && now >= state.deadline;
  if (action.type === "timeout" && !timedOut) return reject("The question is still open.");
  if (action.type === "answer" && !WORD_TYPES.some(({ id }) => id === action.choice)) return reject("Choose a word type in this round.");
  const word = state.deck[state.deckIndex];
  const correct = !timedOut && word.type === action.choice;
  const hearts = state.hearts - Number(!correct);
  const hits = state.hits + Number(correct);
  const complete = hearts === 0 || hits === MAX_WHACK_HITS;
  const type = WORD_TYPES.find(({ id }) => id === word.type);
  const next = {
    ...state, hearts, hits, score: hits * 100, xp: hits * 10, deadline: null, phase: "review",
    feedback: feedback(timedOut ? "timeout" : correct ? "correct" : "wrong", word.text + " ay " + type.label + ". " + type.explanation, correct ? 100 : 0, type.label),
  };
  return transition(next, {
    complete,
    observations: [observation(state, { skill: SKILLS[2], itemId: word.text, correct, firstAttempt: true, hintUsed: false, timedOut }, now)],
  });
}

function moveChoice(state, action, now) {
  const current = state.rounds[state.round];
  if (action.type === "next" && state.phase === "review") {
    if (state.round + 1 >= state.rounds.length) return reject();
    return transition(blankRound({ ...state, round: state.round + 1 }, now));
  }
  if (state.phase !== "playing") return reject();
  if (action.type === "hint" && !state.hint) {
    return transition({ ...state, hint: current.hint }, { hintContext: { skillId: current.skill, itemIndex: state.round } });
  }
  if (action.type !== "answer" || !current.view.options.some(({ id }) => id === action.choice) || state.rejected.includes(action.choice)) {
    return reject("Choose an available answer in this round.");
  }
  const correct = action.choice === current.answer;
  const observations = [observation(state, {
    skill: current.skill, itemId: current.itemId, correct, firstAttempt: state.rejected.length === 0, hintUsed: Boolean(state.hint),
  }, now)];
  if (!correct) {
    return transition({
      ...state, rejected: [...state.rejected, action.choice], feedback: feedback("wrong", "Subukan ang isa pang sagot."),
    }, { observations });
  }
  const points = 100 - (state.hint ? 25 : 0) - (state.rejected.length ? 25 : 0);
  const complete = state.round + 1 === state.rounds.length;
  const next = {
    ...state, phase: "review", score: state.score + points, xp: complete ? 100 : 0,
    feedback: feedback("correct", current.explanation, points, current.summary),
    results: [...state.results, { text: current.summary, points }],
  };
  return transition(next, { complete, observations });
}

function moveMemory(state, action, now) {
  if (action.type === "next" && state.phase === "review") {
    if (state.round + 1 >= state.boards.length) return reject();
    return transition(blankMemoryBoard(blankRound({ ...state, round: state.round + 1 }, now)));
  }
  if (state.phase !== "playing") return reject();
  const board = state.boards[state.round];
  const hideAt = state.hideAt;
  if (hideAt !== null && now < hideAt) return reject("Wait for the cards to turn over.");
  const faceUp = hideAt === null ? state.faceUp : [];
  if (action.type === "hint" && state.hintCard === null) {
    const hintCard = getHintCard(state, board);
    const pair = board.cards[hintCard].pair;
    return transition({
      ...state, faceUp, hideAt: null, hintCard, hint: pair.meaning,
      score: state.bankedScore + memoryScore(state.matched.length / 2, state.misses, true),
    }, { hintContext: { skillId: SKILLS[4], itemIndex: state.round * 10 + board.pairs.findIndex(({ compound }) => compound === pair.compound) } });
  }
  if (action.type !== "flip" || !board.cards[action.cardId] || state.matched.includes(action.cardId)) {
    return reject("Choose an unmatched card on this board.");
  }
  const first = faceUp[0];
  if (first === undefined || first === action.cardId) {
    return transition({ ...state, faceUp: first === undefined ? [action.cardId] : [], hideAt: null, feedback: null });
  }
  const pair = board.cards[first].pair;
  const match = pair.compound === board.cards[action.cardId].pair.compound;
  const matched = match ? [...state.matched, first, action.cardId] : state.matched;
  const misses = state.misses + Number(!match);
  const observed = state.observed.includes(pair.compound) ? state.observed : [...state.observed, pair.compound];
  const observations = [observation(state, {
    skill: SKILLS[4], itemId: pair.compound, correct: match, firstAttempt: !state.observed.includes(pair.compound),
    hintUsed: state.hintCard !== null && board.cards[state.hintCard].pair.compound === pair.compound,
  }, now, state.round * 10 + board.pairs.findIndex(({ compound }) => compound === pair.compound))];
  const boardComplete = matched.length === board.cards.length;
  const complete = boardComplete && state.round === state.boards.length - 1;
  const boardPoints = memoryScore(matched.length / 2, misses, state.hintCard !== null);
  return transition({
    ...state, matched, misses, observed, moves: state.moves + 1,
    score: state.bankedScore + boardPoints,
    xp: complete ? 100 : 0,
    phase: boardComplete ? "review" : "playing",
    faceUp: match ? [] : [first, action.cardId],
    hideAt: match ? null : now + MEMORY_PAUSE_MS,
    feedback: match
      ? feedback(boardComplete ? "board-complete" : "match", pair.meaning, boardComplete ? boardPoints : 100, pair.compound)
      : feedback("mismatch", "Hindi magkatugma ang mga salita. Subukan muli."),
    results: match ? [...state.results, { text: pair.compound, points: 100, meaning: pair.meaning }] : state.results,
  }, { complete, observations });
}

export function moveRanked(state, action, now = Date.now()) {
  if (action.type === "abandon") return transition(state, { abandon: true });
  if (state.gameId === 2) return whackMove(state, action, now);
  if (state.gameId === 4) return moveMemory(state, action, now);
  return moveChoice(state, action, now);
}

export function projectRanked(run, now = Date.now()) {
  const state = run.state;
  const totalRounds = state.gameId === 2 ? null : state.gameId === 4 ? state.boards.length : CHOICE_ROUNDS;
  const shared = {
    runId: run.runId, version: run.version, status: run.status, gameId: state.gameId,
    round: state.round, totalRounds, phase: state.phase, score: state.score, xp: state.xp,
    mode: state.mode, serverNow: now, feedback: state.feedback, hint: state.hint, rejected: state.rejected, results: state.results,
  };
  if (run.status === "abandoned") return { ...shared, feedback: null, hint: null };
  if (state.gameId === 2) {
    const { hearts, hits, deadline, deck, deckIndex } = state;
    return {
      ...shared, hearts, hits, deadline,
      word: deck[deckIndex].text, options: WORD_TYPES.map(({ id, label }) => ({ id, label })),
    };
  }
  if (state.gameId === 4) {
    const { matched, hintCard, moves } = state;
    const board = state.boards[state.round];
    const hideAt = state.hideAt !== null && now < state.hideAt ? state.hideAt : null;
    const faceUp = state.hideAt === null || hideAt !== null ? state.faceUp : [];
    return {
      ...shared, hideAt, pairsFound: matched.length / 2, pairsTotal: board.pairs.length, moves,
      cards: board.cards.map((card, id) => ({
        id, word: matched.includes(id) || faceUp.includes(id) ? card.word : null,
        matched: matched.includes(id), hinted: hintCard === id && !matched.includes(id),
      })),
    };
  }
  return { ...shared, ...state.rounds[state.round].view };
}
