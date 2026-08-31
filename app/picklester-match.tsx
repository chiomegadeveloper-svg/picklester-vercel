"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import {
  Camera,
  CheckCircle2,
  CircleUserRound,
  ImagePlus,
  Loader2,
  Minus,
  Play,
  Plus,
  QrCode,
  ScanLine,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "./lib/supabase";
import type { PlayerProfile } from "./picklester-types";

type MatchFormat = "solo" | "duo";
type MatchRole = "player" | "referee";
type StartMode = "menu" | "create" | "scan" | "pairing";

type GameParticipant = {
  user_id: string;
  role: MatchRole;
  position: number | null;
  name: string;
  username: string | null;
  avatar_url: string | null;
  individual_points: number;
  mmr_delta: number;
  was_winner: boolean;
  was_mvp: boolean;
};

export type MatchResult = {
  role: MatchRole;
  won: boolean;
  isMvp: boolean;
  mmrDelta: number;
  score: string;
};

type GameState = {
  id: string;
  join_code: string;
  format: MatchFormat;
  creator_id: string;
  status: "pairing" | "ready" | "scoring" | "completed" | "cancelled";
  honesty_mode?: boolean;
  player_limit: number;
  total_required: number;
  score_team_one: number;
  score_team_two: number;
  score_limit: 11 | 15 | 21;
  serving_team: 1 | 2;
  server_number: 0 | 1 | 2;
  winner_team: 1 | 2 | null;
  mvp_user_id: string | null;
  participants: GameParticipant[];
};

function extractJoinCode(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  try {
    const url = new URL(clean);
    return (url.searchParams.get("join") || "").trim().toUpperCase();
  } catch {
    return clean
      .replace(/^PICKLESTER:/i, "")
      .replace(/[^A-Z0-9]/gi, "")
      .toUpperCase();
  }
}

function databaseMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("start_picklester_honesty_game"))
    return "Honesty Start is missing. Run the Picklester V25 honesty-start repair SQL.";
  if (normalized.includes("update_picklester_honesty_score"))
    return "Honesty scoring is missing. Run the Picklester V18 SQL.";
  if (normalized.includes("finalize_picklester_game_v15"))
    return "Match finalization is missing. Run the corrected Picklester V15 SQL.";
  if (normalized.includes("could not find the function"))
    return `Database function missing: ${message}`;
  return message;
}

export function PicklesterMatchDialog({
  open,
  initialMode,
  viewer,
  onOpenChange,
  onResult,
  onOpenShop,
}: {
  open: boolean;
  initialMode: "create" | "scan";
  viewer: PlayerProfile;
  onOpenChange: (open: boolean) => void;
  onResult: (result: MatchResult) => void;
  onOpenShop: () => void;
}) {
  const [mode, setMode] = useState<StartMode>(initialMode);
  const [format, setFormat] = useState<MatchFormat>("duo");
  const [creatorRole, setCreatorRole] = useState<MatchRole>("player");
  const [honestyMode, setHonestyMode] = useState(false);
  const [honestyAccepted, setHonestyAccepted] = useState(false);
  const [scoreLimit, setScoreLimit] = useState<11 | 15 | 21>(11);
  const [joinRole, setJoinRole] = useState<MatchRole>("player");
  const [joinCode, setJoinCode] = useState("");
  const [game, setGame] = useState<GameState | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [gamePassPromptOpen, setGamePassPromptOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrame = useRef<number | null>(null);
  const reportedGame = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setMode(initialMode);
      setGame(null);
      setQrImage("");
      setJoinCode("");
      reportedGame.current = null;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, initialMode]);

  const activeGameCode = game?.join_code;
  const activeGameStatus = game?.status;
  useEffect(() => {
    if (
      !open ||
      !activeGameCode ||
      !["pairing", "ready", "scoring"].includes(activeGameStatus || "")
    )
      return;
    const timer = window.setInterval(
      () => void loadGame(activeGameCode, false),
      3500,
    );
    return () => window.clearInterval(timer);
  }, [open, activeGameCode, activeGameStatus]);

  useEffect(() => () => stopCamera(), []);

  async function verifyCurrentPlayer() {
    const { data, error } = await supabase
      .from("profiles")
      .select("verified,role")
      .eq("id", viewer.id)
      .maybeSingle();
    if (error) throw new Error(databaseMessage(error.message));
    if (
      !data ||
      (!data.verified && data.role !== "owner" && data.role !== "admin")
    )
      throw new Error("Owner verification is required before joining a game.");
  }

  function reportGameError(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback;
    if (message.toLowerCase().includes("daily limit")) {
      setGamePassPromptOpen(true);
      return;
    }
    toast.error(message);
  }

  async function createGame() {
    setBusy(true);
    try {
      await verifyCurrentPlayer();
      const { data, error } = await supabase.rpc(honestyMode ? "create_picklester_honesty_game" : "create_picklester_game_v13", {
        game_format: format,
        ...(honestyMode ? {} : { creator_role: creatorRole }),
        game_score_limit: scoreLimit,
      });
      if (error) throw new Error(databaseMessage(error.message));
      const code = String(data || "").toUpperCase();
      if (!code) throw new Error("The game code was not created.");
      await loadGame(code, true);
      const joinUrl = `${window.location.origin}/?join=${encodeURIComponent(code)}`;
      setQrImage(
        await QRCode.toDataURL(joinUrl, {
          width: 420,
          margin: 2,
          color: { dark: "#06101a", light: "#ffffff" },
        }),
      );
      setMode("pairing");
      toast.success("Game created. Let every member scan your QR.");
    } catch (error) {
      reportGameError(error, "Game could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function loadGame(code: string, reportError = true) {
    const normalized = extractJoinCode(code);
    if (!normalized) return;
    const { data, error } = await supabase.rpc("get_picklester_game", {
      requested_code: normalized,
    });
    if (error) {
      if (reportError) toast.error(databaseMessage(error.message));
      return null;
    }
    if (!data) {
      if (reportError) toast.error("Game code not found or no longer open.");
      return null;
    }
    setJoinCode(normalized);
    const loaded = data as GameState;
    setGame(loaded);
    if (loaded.creator_id === viewer.id && !qrImage) {
      const joinUrl = `${window.location.origin}/?join=${encodeURIComponent(normalized)}`;
      setQrImage(
        await QRCode.toDataURL(joinUrl, {
          width: 420,
          margin: 2,
          color: { dark: "#06101a", light: "#ffffff" },
        }),
      );
    }
    return loaded;
  }

  async function findGame() {
    setBusy(true);
    try {
      await verifyCurrentPlayer();
      const loaded = await loadGame(joinCode, true);
      if (
        loaded?.participants.some(
          (participant) => participant.user_id === viewer.id,
        )
      ) {
        setMode("pairing");
        toast.success("Pairing resumed.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Game could not be opened.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function joinGame() {
    if (!game) return;
    setBusy(true);
    try {
      await verifyCurrentPlayer();
      const { error } = await supabase.rpc("join_picklester_game", {
        requested_code: game.join_code,
        desired_role: joinRole,
      });
      if (error) throw new Error(databaseMessage(error.message));
      await loadGame(game.join_code, true);
      stopCamera();
      setMode("pairing");
      toast.success(
        joinRole === "referee"
          ? "You joined as volunteer referee."
          : "You joined as a player.",
      );
    } catch (error) {
      reportGameError(error, "You could not join this game.");
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unavailable");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      setCameraOpen(true);
      window.setTimeout(() => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("autoplay", "true");
        videoRef.current.setAttribute("muted", "true");
        videoRef.current.setAttribute("playsinline", "true");
        void videoRef.current.play().catch(() => undefined);
        let lastScanAt = 0;
        const scan = async () => {
          if (!videoRef.current || !streamRef.current) return;
          if (performance.now() - lastScanAt < 180) {
            scanFrame.current = window.requestAnimationFrame(scan);
            return;
          }
          lastScanAt = performance.now();
          try {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            if (!canvas || video.readyState < 2) throw new Error("waiting");
            const scale = Math.min(1, 720 / video.videoWidth);
            const width = Math.round(video.videoWidth * scale);
            const height = Math.round(video.videoHeight * scale);
            if (!width || !height) throw new Error("waiting");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d", {
              willReadFrequently: true,
            });
            if (!context) throw new Error("canvas");
            context.drawImage(video, 0, 0, width, height);
            const image = context.getImageData(0, 0, width, height);
            const result = jsQR(image.data, width, height, {
              inversionAttempts: "attemptBoth",
            });
            const code = extractJoinCode(result?.data || "");
            if (code) {
              setJoinCode(code);
              stopCamera();
              const loaded = await loadGame(code, true);
              if (
                loaded?.participants.some(
                  (participant) => participant.user_id === viewer.id,
                )
              )
                setMode("pairing");
              return;
            }
          } catch {
            /* continue scanning */
          }
          scanFrame.current = window.requestAnimationFrame(scan);
        };
        scanFrame.current = window.requestAnimationFrame(scan);
      }, 120);
    } catch {
      toast.error(
        "Camera access is blocked here. Open Picklester in Chrome or scan a saved QR screenshot below.",
      );
    }
  }

  async function scanQrImage(file: File | null) {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Image could not be read.");
      context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(image.data, canvas.width, canvas.height, {
        inversionAttempts: "attemptBoth",
      });
      const code = extractJoinCode(result?.data || "");
      if (!code) throw new Error("No Picklester QR was found in that image.");
      setJoinCode(code);
      const loaded = await loadGame(code, true);
      if (
        loaded?.participants.some(
          (participant) => participant.user_id === viewer.id,
        )
      )
        setMode("pairing");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "QR image could not be scanned.",
      );
    }
  }

  async function changeRole(role: MatchRole) {
    if (!game || role === myParticipant?.role) return;
    setBusy(true);
    const { error } = await supabase.rpc("change_picklester_game_role", {
      requested_code: game.join_code,
      desired_role: role,
    });
    if (error) toast.error(databaseMessage(error.message));
    else {
      await loadGame(game.join_code, true);
      toast.success(
        role === "referee"
          ? "You are now the volunteer referee."
          : "You are now a player.",
      );
    }
    setBusy(false);
  }

  async function startGame() {
    if (!game) return;
    setBusy(true);
    const { error } = await supabase.rpc(game.honesty_mode ? "start_picklester_honesty_game" : "start_picklester_game", {
      requested_code: game.join_code,
    });
    if (error) toast.error(databaseMessage(error.message));
    else {
      await loadGame(game.join_code, true);
      toast.success("Game started. Scoring control is live.");
    }
    setBusy(false);
  }

  async function changePlayerScore(playerId: string, delta: -1 | 1) {
    if (!game) return;
    setBusy(true);
    const { error } = await supabase.rpc(game.honesty_mode ? "update_picklester_honesty_score" : "update_picklester_player_score", {
      requested_code: game.join_code,
      scored_user: playerId,
      score_delta: delta,
    });
    if (error) toast.error(databaseMessage(error.message));
    else {
      const scorer = game.participants.find((item) => item.user_id === playerId);
      const scorerTeam = game.format === "solo" ? scorer?.position : (scorer?.position || 0) <= 2 ? 1 : 2;
      const nextTeamScore = (scorerTeam === 1 ? game.score_team_one : game.score_team_two) + delta;
      if (!game.honesty_mode && delta === 1 && nextTeamScore >= game.score_limit) {
        const finalized = await supabase.rpc("finalize_picklester_game_v15", { requested_code: game.join_code });
        if (finalized.error) toast.error(databaseMessage(finalized.error.message));
        else toast.success(`Target score reached. ${game.format === "solo" ? `Player ${scorerTeam}` : `Team ${scorerTeam === 1 ? "A" : "B"}`} wins!`);
      }
      await loadGame(game.join_code, false);
    }
    setBusy(false);
  }

  async function changeServe(servingTeam: 1 | 2, serverNumber: 0 | 1 | 2) {
    if (!game) return;
    setBusy(true);
    const { error } = await supabase.rpc("update_picklester_serve", {
      requested_code: game.join_code,
      new_serving_team: servingTeam,
      new_server_number: serverNumber,
    });
    if (error) toast.error(databaseMessage(error.message));
    else await loadGame(game.join_code, false);
    setBusy(false);
  }

  async function finishGame() {
    if (!game) return;
    setBusy(true);
    const { error } = await supabase.rpc("finalize_picklester_game_v15", {
      requested_code: game.join_code,
    });
    if (error) toast.error(databaseMessage(error.message));
    else await loadGame(game.join_code, false);
    setBusy(false);
  }

  function stopCamera() {
    if (scanFrame.current != null)
      window.cancelAnimationFrame(scanFrame.current);
    scanFrame.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }

  function close(next: boolean) {
    if (!next) stopCamera();
    onOpenChange(next);
  }

  const myParticipant = game?.participants.find(
    (participant) => participant.user_id === viewer.id,
  );
  const players =
    game?.participants.filter((participant) => participant.role === "player") ||
    [];
  const referee =
    game?.participants.find((participant) => participant.role === "referee") ||
    null;
  const ready = Boolean(game && players.length === game.player_limit && (game.honesty_mode || referee));
  const canScore = Boolean(myParticipant && (myParticipant.role === "referee" || game?.honesty_mode));
  const scoringActive = Boolean(game && (game.status === "scoring" || (game.honesty_mode && ready)));
  const winningTeam =
    game &&
    Math.max(game.score_team_one, game.score_team_two) >= game.score_limit
      ? game.score_team_one > game.score_team_two
        ? 1
        : 2
      : null;

  useEffect(() => {
    if (
      !open ||
      !game ||
      game.status !== "completed" ||
      !myParticipant ||
      reportedGame.current === game.id
    )
      return;
    reportedGame.current = game.id;
    onResult({
      role: myParticipant.role,
      won: myParticipant.was_winner,
      isMvp: myParticipant.was_mvp,
      mmrDelta: myParticipant.mmr_delta || 0,
      score: `${game.score_team_one}–${game.score_team_two}`,
    });
    onOpenChange(false);
  }, [game, myParticipant, onOpenChange, onResult, open]);

  return (
    <>
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="match-dialog game-pairing-dialog">
        <DialogHeader>
          <div className="dialog-kicker">
            <QrCode /> PICKLESTER GAME
          </div>
          <DialogTitle>
            {mode === "create"
              ? "Create a game"
              : mode === "scan"
                ? "Scan to join"
                : mode === "pairing"
                  ? "Game pairing"
                  : "Choose an action"}
          </DialogTitle>
          <DialogDescription>
            Every game is recorded. One creator, the required players, and one
            volunteer referee join the same event.
          </DialogDescription>
        </DialogHeader>

        {mode === "menu" && (
          <div className="match-entry-grid">
            <button onClick={() => setMode("create")}>
              <Users />
              <b>Create game</b>
              <small>Display one QR for everyone</small>
            </button>
            <button onClick={() => setMode("scan")}>
              <ScanLine />
              <b>Scan QR</b>
              <small>Join as player or referee</small>
            </button>
          </div>
        )}

        {mode === "create" && (
          <div className="dialog-body">
            <label>Game format</label>
            <div className="format-picker">
              <button
                className={format === "solo" ? "selected" : ""}
                onClick={() => setFormat("solo")}
              >
                <CircleUserRound /> Solo<small>2 players + referee</small>
              </button>
              <button
                className={format === "duo" ? "selected" : ""}
                onClick={() => setFormat("duo")}
              >
                <Users /> Duo<small>4 players + referee</small>
              </button>
            </div>
            <label>Game points</label>
            <div className="score-limit-picker">
              {([11, 15, 21] as const).map((limit) => (
                <button
                  key={limit}
                  className={scoreLimit === limit ? "selected" : ""}
                  onClick={() => setScoreLimit(limit)}
                >
                  <b>{limit}</b>
                  <small>points</small>
                </button>
              ))}
            </div>
            <label className={`honesty-toggle ${honestyMode ? "selected" : ""}`}>
              <input type="checkbox" checked={honestyMode} onChange={(event) => {setHonestyMode(event.target.checked); setHonestyAccepted(event.target.checked); setCreatorRole("player")}} />
              <span className="honesty-check" aria-hidden="true">{honestyMode ? "✓" : ""}</span>
              <ShieldCheck />
              <span className="honesty-copy"><b>Honesty mode</b><small>Play without a volunteer referee. All players agree to report the final score truthfully.</small></span>
              <em>No referee</em>
            </label>
            {!honestyMode && <><label>Your role as creator</label><div className="role-picker">
              <button
                className={creatorRole === "player" ? "selected" : ""}
                onClick={() => setCreatorRole("player")}
              >
                <UserRoundCheck />
                <b>Player</b>
                <small>Take the first player slot</small>
              </button>
              <button
                className={creatorRole === "referee" ? "selected" : ""}
                onClick={() => setCreatorRole("referee")}
              >
                <ShieldCheck />
                <b>Volunteer referee</b>
                <small>Reserve the only referee slot</small>
              </button>
            </div></>}
            <div className="rule-note">
              <QrCode />
              <span>
                <b>One creator QR</b>
                <small>
                  All other members scan your QR and choose an available role.
                </small>
              </span>
            </div>
            <button
              className="dialog-primary"
              onClick={createGame}
              disabled={busy || (honestyMode && !honestyAccepted)}
            >
              {busy ? (
                <Loader2 className="spin" />
              ) : (
                <>
                  Create game <QrCode />
                </>
              )}
            </button>
            <button
              className="dialog-secondary-link"
              onClick={() => setMode("scan")}
            >
              Scan a creator’s QR instead
            </button>
          </div>
        )}

        {mode === "scan" && (
          <div className="dialog-body scan-join-body">
            {cameraOpen ? (
              <div className="qr-camera">
                <video ref={videoRef} playsInline muted />
                <canvas ref={canvasRef} hidden />
                <span>
                  <ScanLine /> Point at the creator’s QR
                </span>
                <button onClick={stopCamera}>Stop camera</button>
              </div>
            ) : (
              <button className="camera-scan-action" onClick={startCamera}>
                <Camera />
                <span>
                  <b>Open QR scanner</b>
                  <small>Use the rear camera</small>
                </span>
              </button>
            )}
            <label className="qr-image-action">
              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  void scanQrImage(event.target.files?.[0] || null)
                }
              />
              <ImagePlus />
              <span>
                <b>Scan saved QR image</b>
                <small>Works when Messenger blocks the camera</small>
              </span>
            </label>
            <div className="auth-divider">
              <span>or enter the game code</span>
            </div>
            <div className="manual-game-code">
              <input
                value={joinCode}
                onChange={(event) =>
                  setJoinCode(event.target.value.toUpperCase())
                }
                placeholder="GAME CODE"
                maxLength={8}
              />
              <button onClick={findGame} disabled={busy}>
                {busy ? <Loader2 className="spin" /> : "Find"}
              </button>
            </div>
            {game && !myParticipant && (
              <>
                <div className="found-game-card">
                  <QrCode />
                  <span>
                    <b>
                      {game.format === "solo" ? "Solo" : "Duo"} to{" "}
                      {game.score_limit} · {game.join_code}
                    </b>
                    <small>
                      {players.length}/{game.player_limit} players ·{" "}
                      {referee ? "Referee joined" : "Referee open"}
                    </small>
                  </span>
                </div>
                <label>Join this game as</label>
                <div className="role-picker">
                  <button
                    className={joinRole === "player" ? "selected" : ""}
                    disabled={players.length >= game.player_limit}
                    onClick={() => setJoinRole("player")}
                  >
                    <UserRoundCheck />
                    <b>Player</b>
                    <small>
                      {players.length >= game.player_limit
                        ? "Player slots full"
                        : "Take next player slot"}
                    </small>
                  </button>
                  <button
                    className={joinRole === "referee" ? "selected" : ""}
                    disabled={Boolean(referee)}
                    onClick={() => setJoinRole("referee")}
                  >
                    <ShieldCheck />
                    <b>Volunteer referee</b>
                    <small>
                      {referee
                        ? "Referee already joined"
                        : "Take the referee slot"}
                    </small>
                  </button>
                </div>
                <button
                  className="dialog-primary"
                  onClick={joinGame}
                  disabled={
                    busy ||
                    (joinRole === "player"
                      ? players.length >= game.player_limit
                      : Boolean(referee))
                  }
                >
                  {busy ? <Loader2 className="spin" /> : "Join game"}
                </button>
              </>
            )}
            <button
              className="dialog-secondary-link"
              onClick={() => setMode("create")}
            >
              Create a new game instead
            </button>
          </div>
        )}

        {mode === "pairing" && game && (
          <div className="dialog-body pairing-body live-pairing-body">
            {game.creator_id === viewer.id && (
              <div className="creator-qr-card">
                {qrImage ? (
                  <img src={qrImage} alt={`QR for game ${game.join_code}`} />
                ) : (
                  <QrCode />
                )}
                <div>
                  <small>GAME CODE</small>
                  <strong>{game.join_code}</strong>
                  <span>Everyone scans this QR</span>
                </div>
              </div>
            )}
            {game.creator_id !== viewer.id && (
              <div className="joined-game-status">
                <CheckCircle2 />
                <span>
                  <b>
                    Joined as{" "}
                    {myParticipant?.role === "referee"
                      ? "volunteer referee"
                      : "player"}
                  </b>
                  <small>Waiting for the creator’s game to fill.</small>
                </span>
              </div>
            )}
            <div className="pair-progress">
              <div>
                <b>{ready ? "All positions filled" : "Waiting for members"}</b>
                <span>
                  {game.format === "solo"
                    ? "3 users required"
                    : "5 users required"}
                </span>
              </div>
              <div className="pair-progress-track">
                <span
                  style={{
                    width: `${Math.round((game.participants.length / game.total_required) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <div className="live-position-grid">
              {Array.from({ length: game.player_limit }).map((_, index) => {
                const participant = players.find(
                  (item) => item.position === index + 1,
                );
                return (
                  <article key={index} className={participant ? "filled" : ""}>
                    <span>
                      {participant?.avatar_url ? (
                        <img src={participant.avatar_url} alt="" />
                      ) : (
                        <CircleUserRound />
                      )}
                    </span>
                    <div>
                      <b>
                        {game.format === "duo"
                          ? `Team ${index < 2 ? "A" : "B"} · Player ${(index % 2) + 1}`
                          : `Player ${index + 1}`}
                      </b>
                      <small>
                        {participant
                          ? `@${participant.username || participant.name}`
                          : "Waiting for scan"}
                      </small>
                    </div>
                    {participant && <CheckCircle2 />}
                  </article>
                );
              })}
              <article
                className={`referee-position ${referee ? "filled" : ""}`}
              >
                <span>
                  {referee?.avatar_url ? (
                    <img src={referee.avatar_url} alt="" />
                  ) : (
                    <ShieldCheck />
                  )}
                </span>
                <div>
                  <b>Volunteer referee</b>
                  <small>
                    {referee
                      ? `@${referee.username || referee.name}`
                      : "Waiting for scan"}
                  </small>
                </div>
                {referee && <CheckCircle2 />}
              </article>
            </div>
            {["pairing", "ready"].includes(game.status) && myParticipant && (
              <div className="pair-role-switch">
                <span>
                  <b>Your position</b>
                  <small>You can change while pairing is open.</small>
                </span>
                <button
                  disabled={
                    busy ||
                    myParticipant.role === "player" ||
                    players.length >= game.player_limit
                  }
                  onClick={() => void changeRole("player")}
                >
                  Player
                </button>
                <button
                  disabled={
                    busy ||
                    myParticipant.role === "referee" ||
                    Boolean(referee && referee.user_id !== viewer.id)
                  }
                  onClick={() => void changeRole("referee")}
                >
                  Referee
                </button>
              </div>
            )}
            {!scoringActive && (
              <div className={`game-ready-note ${ready ? "ready" : ""}`}>
                <ShieldCheck />
                <span>
                  <b>{ready ? "Game ready" : "Pairing in progress"}</b>
                  <small>
                    {ready
                      ? "Every player is ready."
                      : "Close this window anytime. Enter the same code to resume pairing."}
                  </small>
                </span>
              </div>
            )}
            {game.status === "ready" && canScore && !game.honesty_mode && (
              <button
                className="dialog-primary start-game-action"
                disabled={busy}
                onClick={() => void startGame()}
              >
                {busy ? (
                  <Loader2 className="spin" />
                ) : (
                  <>
                    <Play /> Start game
                  </>
                )}
              </button>
            )}
            {scoringActive && (
              <div className="live-score-control">
                <div className="score-status">
                  <span>LIVE SCORING · TO {game.score_limit}</span>
                  <b>
                    {game.honesty_mode
                      ? "Honesty mode · players report the score together"
                      : canScore
                      ? "Assign every point to its scorer"
                      : "Volunteer referee scoring"}
                  </b>
                </div>
                <div className="pickle-score-call">
                  <strong>
                    {game.score_team_one}–{game.score_team_two}–
                    {game.server_number}
                  </strong>
                  <small>
                    {game.serving_team === 1
                      ? game.format === "solo"
                        ? "Player 1"
                        : "Team A"
                      : game.format === "solo"
                        ? "Player 2"
                        : "Team B"}{" "}
                    serving · server {game.server_number}
                  </small>
                </div>
                <div className="scoreboard-grid">
                  {([1, 2] as const).map((team) => {
                    const score =
                      team === 1 ? game.score_team_one : game.score_team_two;
                    const teamPlayers = players.filter((participant) =>
                      game.format === "solo"
                        ? participant.position === team
                        : team === 1
                          ? Boolean(
                              participant.position && participant.position <= 2,
                            )
                          : Boolean(
                              participant.position && participant.position > 2,
                            ),
                    );
                    return (
                      <article
                        key={team}
                        className={game.serving_team === team ? "serving" : ""}
                      >
                        <small>
                          {game.format === "solo"
                            ? `PLAYER ${team}`
                            : `TEAM ${team === 1 ? "A" : "B"}`}
                        </small>
                        <strong>{score}</strong>
                        <div className="individual-score-list">
                          {teamPlayers.map((participant) => (
                            <div key={participant.user_id}>
                              <span>
                                @{participant.username || participant.name}
                                <em>{participant.individual_points} pts</em>
                              </span>
                              {canScore && (
                                <aside>
                                  <button
                                    disabled={
                                      busy ||
                                      participant.individual_points === 0
                                    }
                                    onClick={() =>
                                      void changePlayerScore(
                                        participant.user_id,
                                        -1,
                                      )
                                    }
                                    aria-label={`Remove point from ${participant.name}`}
                                  >
                                    <Minus />
                                  </button>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      void changePlayerScore(
                                        participant.user_id,
                                        1,
                                      )
                                    }
                                    aria-label={`Add point to ${participant.name}`}
                                  >
                                    <Plus />
                                  </button>
                                </aside>
                              )}
                            </div>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
                {canScore && (
                  <div className="serve-control">
                    <span>
                      <b>Serving team</b>
                      <button
                        className={game.serving_team === 1 ? "active" : ""}
                        onClick={() => void changeServe(1, game.server_number)}
                      >
                        A / P1
                      </button>
                      <button
                        className={game.serving_team === 2 ? "active" : ""}
                        onClick={() => void changeServe(2, game.server_number)}
                      >
                        B / P2
                      </button>
                    </span>
                    <span>
                      <b>Server number</b>
                      {([0, 1, 2] as const).map((server) => (
                        <button
                          key={server}
                          className={
                            game.server_number === server ? "active" : ""
                          }
                          onClick={() =>
                            void changeServe(game.serving_team, server)
                          }
                        >
                          {server}
                        </button>
                      ))}
                    </span>
                  </div>
                )}
                <p className="score-rule-note">
                  First to {game.score_limit} points wins automatically
                </p>
                {winningTeam && canScore && !game.honesty_mode && (
                  <div className="good-game-panel">
                    <b>
                      {game.format === "solo"
                        ? `Player ${winningTeam}`
                        : `Team ${winningTeam === 1 ? "A" : "B"}`}{" "}
                      reached the winning score
                    </b>
                    <small>
                      The highest-scoring player on the winning side becomes MVP
                      automatically.
                    </small>
                    <button
                      className="good-game-action"
                      disabled={busy}
                      onClick={() => void finishGame()}
                    >
                      Good game!
                    </button>
                    <small>
                      Winners earn +3 MMR, losses −4 MMR, and the MVP earns
                      another +3.
                    </small>
                  </div>
                )}
              </div>
            )}
            {game.status === "completed" && (
              <div className="completed-game-card">
                <CheckCircle2 />
                <span>
                  <b>Good game! Result recorded</b>
                  <small>
                    {game.score_team_one}–{game.score_team_two} · Opening your
                    result.
                  </small>
                </span>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
    <Dialog open={gamePassPromptOpen} onOpenChange={setGamePassPromptOpen}>
      <DialogContent className="match-dialog gamepass-limit-dialog">
        <div className="gamepass-limit-icon"><ShieldCheck /></div>
        <DialogHeader>
          <DialogTitle>Daily game limit reached</DialogTitle>
          <DialogDescription>
            You have reached the maximum number of game matches for today.
          </DialogDescription>
        </DialogHeader>
        <div className="gamepass-limit-copy">
          <b>Want to continue playing?</b>
          <p>You may purchase an additional Game Pass in the Shop, or wait until tomorrow to receive another 5 free games.</p>
        </div>
        <button className="primary-button gamepass-shop-button" onClick={() => { setGamePassPromptOpen(false); close(false); onOpenShop(); }}>
          View Game Passes in Shop
        </button>
        <button className="gamepass-later-button" onClick={() => setGamePassPromptOpen(false)}>
          Maybe tomorrow
        </button>
      </DialogContent>
    </Dialog>
    </>
  );
}
